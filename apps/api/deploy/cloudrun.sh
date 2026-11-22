#!/usr/bin/env bash
# Deploy the CareLayer API to Google Cloud Run (Z11). Database: Neon. Run from anywhere.
#
#   apps/api/deploy/cloudrun.sh setup      once: enable APIs, image registry, service account
#   apps/api/deploy/cloudrun.sh secrets    upload the secret values from deploy/.env.production
#   apps/api/deploy/cloudrun.sh release    build the image, run migrations, deploy the service
#   SEED_ADMIN_EMAIL=you@yourdomain apps/api/deploy/cloudrun.sh seed
#                                          ONCE on a fresh database: demo accounts (wipes tables)
#   apps/api/deploy/cloudrun.sh url        print the service URL
#   (also: build, migrate, deploy on their own)
#
# Needs: gcloud signed in (`gcloud auth login`), a project with billing, and
# apps/api/deploy/.env.production (copy .env.production.example). Settings (env vars):
#   GCP_PROJECT  default: gcloud's current project
#   GCP_REGION   default: europe-west2 (London, next to the Neon database in eu-west-2)
#   ENV_FILE     default: apps/api/deploy/.env.production
#
# Service flags (cost decision, see docs/TASKS.md Z11): ONE instance at most (in-memory rate
# limit, in-process loops), scaled to zero when idle, CPU only during requests:
#   --min-instances 0 --max-instances 1 --cpu-throttling   (pay per use, ~$0 at demo traffic)
# The background loops then only run while requests are being served (the work is delayed, never
# lost or doubled). Always-on (--min-instances 1 --no-cpu-throttling) costs ~$44-60/month.
# Planned: Cloud Scheduler calling a protected tick endpoint every minute (TASKS Z11 follow-up).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-europe-west2}"
ENV_FILE="${ENV_FILE:-$HERE/.env.production}"
SERVICE=carelayer-api
REPO=carelayer
SA_NAME=carelayer-api
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
IMAGE_BASE="$REGION-docker.pkg.dev/$PROJECT/$REPO/api"

# Values that go to Secret Manager (never plain env vars, never printed).
SECRET_KEYS=(DATABASE_URL JWT_ACCESS_SECRET AUTH_PEPPER WALLET_ENCRYPTION_KEY STELLAR_TREASURY_SECRET
  X402_FACILITATOR_API_KEY PAYSTACK_SECRET_KEY LLM_API_KEY EMAIL_API_KEY)
# In the env file but not for the service (scripts only, or set by Cloud Run itself).
SKIP_KEYS=(X402_TEST_PAYER_SECRET PORT DATABASE_URL_TEST)

die() { echo "error: $*" >&2; exit 1; }
info() { echo "[deploy] $*"; }
contains() { local x; for x in "${@:2}"; do [[ "$x" == "$1" ]] && return 0; done; return 1; }
secret_name() { echo "carelayer-$(echo "$1" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"; }

[[ -n "$PROJECT" ]] || die "no project: set GCP_PROJECT or run: gcloud config set project <id>"
command -v gcloud >/dev/null || die "gcloud is not installed (or use Google Cloud Shell)"

# KEY=VALUE lines of the env file (comments and blanks skipped; VALUE may contain '=').
env_pairs() {
  [[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE (copy deploy/.env.production.example)"
  grep -Ev '^[[:space:]]*(#|$)' "$ENV_FILE" | sed -E 's/^[[:space:]]+//'
}
env_value() { env_pairs | awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2) }' | tail -n1; }

# Plain env vars for the service, as a YAML file (handles commas, spaces, < > in values).
env_vars_file() {
  local out; out="$(mktemp)"
  local line key value
  while IFS= read -r line; do
    key="${line%%=*}"; value="${line#*=}"
    contains "$key" "${SECRET_KEYS[@]}" && continue
    contains "$key" "${SKIP_KEYS[@]}" && continue
    [[ -z "$value" ]] && continue
    value="${value//\\/\\\\}"; value="${value//\"/\\\"}"
    printf '%s: "%s"\n' "$key" "$value" >>"$out"
  done < <(env_pairs)
  echo "$out"
}

# "--set-secrets=KEY=name:latest,..." for every secret that exists in Secret Manager (or nothing).
secret_flag() {
  local refs="" key name
  for key in "${SECRET_KEYS[@]}"; do
    name="$(secret_name "$key")"
    if gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
      refs="${refs:+$refs,}$key=$name:latest"
    fi
  done
  [[ -n "$refs" ]] && echo "--set-secrets=$refs"
  return 0
}

cmd_setup() {
  info "project $PROJECT, region $REGION"
  gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
    cloudbuild.googleapis.com secretmanager.googleapis.com --project "$PROJECT"
  if ! gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud artifacts repositories create "$REPO" --repository-format docker \
      --location "$REGION" --project "$PROJECT" --description "CareLayer images"
  fi
  # Newer projects run Cloud Build as the default compute service account, which has no build
  # permissions by default (403 reading the uploaded source). Give it Cloud Build's builder role.
  local number; number="$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')"
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:$number-compute@developer.gserviceaccount.com" \
    --role roles/cloudbuild.builds.builder --condition None >/dev/null
  if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
      --display-name "CareLayer API (Cloud Run)"
  fi
  info "setup done"
}

cmd_secrets() {
  local key value name current
  for key in "${SECRET_KEYS[@]}"; do
    value="$(env_value "$key")"
    name="$(secret_name "$key")"
    if [[ -z "$value" ]]; then info "$key: empty in env file, skipped"; continue; fi
    if ! gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
      gcloud secrets create "$name" --replication-policy automatic --project "$PROJECT" >/dev/null
    fi
    current="$(gcloud secrets versions access latest --secret "$name" --project "$PROJECT" 2>/dev/null || true)"
    if [[ "$current" == "$value" ]]; then
      info "$key: unchanged"
    else
      printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project "$PROJECT" >/dev/null
      info "$key: uploaded (new version)"
    fi
    gcloud secrets add-iam-policy-binding "$name" --project "$PROJECT" \
      --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
  done
  info "secrets done (values never printed)"
}

image_tag() {
  local sha; sha="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- apps/api packages/shared Dockerfile)" ]]; then
    sha="$sha-dirty-$(date +%s)"
  fi
  echo "$sha"
}

cmd_build() {
  IMAGE="$IMAGE_BASE:$(image_tag)"
  info "building $IMAGE (Cloud Build)"
  (cd "$REPO_ROOT" && gcloud builds submit --project "$PROJECT" --region "$REGION" --tag "$IMAGE" .)
}

current_image() {
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --format 'value(spec.template.spec.containers[0].image)' 2>/dev/null || true
}

run_job() { # name, command (space separated), extra flags...
  local name="$1" command="$2"; shift 2
  gcloud run jobs deploy "$name" --image "${IMAGE:?build first}" --region "$REGION" \
    --project "$PROJECT" --service-account "$SA" --max-retries 0 --task-timeout 10m \
    --command "${command%% *}" --args "$(echo "${command#* }" | tr ' ' ',')" "$@"
  gcloud run jobs execute "$name" --region "$REGION" --project "$PROJECT" --wait
}

cmd_migrate() {
  IMAGE="${IMAGE:-$(current_image)}"
  info "migrations with $IMAGE"
  run_job carelayer-migrate "npx prisma migrate deploy" \
    --set-secrets "DATABASE_URL=$(secret_name DATABASE_URL):latest"
}

cmd_seed() {
  IMAGE="${IMAGE:-$(current_image)}"
  info "ONE-TIME demo seed with $IMAGE: it refuses if any real account exists"
  local vars; vars="$(env_vars_file)"
  echo 'CARELAYER_SEED_PRODUCTION: "wipe-and-seed"' >>"$vars"
  [[ -n "${SEED_ADMIN_EMAIL:-}" ]] || die "set SEED_ADMIN_EMAIL=<an inbox you own> (the admin signs in with emailed codes)"
  printf 'CARELAYER_SEED_ADMIN_EMAIL: "%s"\n' "$SEED_ADMIN_EMAIL" >>"$vars"
  run_job carelayer-seed "node dist/seed/run.js" --env-vars-file "$vars" $(secret_flag)
  rm -f "$vars"
}

cmd_deploy() {
  IMAGE="${IMAGE:-$(current_image)}"
  [[ -n "$IMAGE" ]] || die "no image: run build (or release) first"
  local vars; vars="$(env_vars_file)"
  info "deploying $SERVICE with $IMAGE"
  gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --project "$PROJECT" \
    --service-account "$SA" --allow-unauthenticated \
    --min-instances 0 --max-instances 1 --cpu-throttling --cpu 1 --memory 512Mi \
    --timeout 120 --concurrency 80 \
    --env-vars-file "$vars" $(secret_flag)
  rm -f "$vars"
  info "health: $(cmd_url)/health"
}

cmd_url() {
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format 'value(status.url)'
}

case "${1:-}" in
  setup) cmd_setup ;;
  secrets) cmd_secrets ;;
  build) cmd_build ;;
  migrate) cmd_migrate ;;
  seed) cmd_seed ;;
  deploy) cmd_deploy ;;
  release) cmd_build; cmd_migrate; cmd_deploy ;;
  url) cmd_url ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
