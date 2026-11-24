import {
  MAX_AGENT_TOKENS,
  type AgentTokenSummary,
  type CreateAgentTokenResponse,
} from '@carelayer/shared';
import { useState, type FormEvent } from 'react';
import { loadErrorMessage } from '../../../api/error-message';
import { useApi } from '../../../api/useApi';
import { useApiQuery } from '../../../api/useApiQuery';
import { useSessionGuard } from '../../../auth/useSessionGuard';
import { Alert } from '../../../components/Alert/Alert';
import { Button } from '../../../components/Button/Button';
import { Input } from '../../../components/Input/Input';
import { formatListDate } from '../../../utils/dates';
import { flowErrorMessage } from '../ask/flow-errors';
import { claudeCodeCommand, MCP_URL } from './claude-connect';
import styles from './ClaudeConnections.module.css';

/**
 * "Use CareLayer in Claude" connections (contract §2, Z12): create an agent token
 * (shown once), list the active ones and remove any at once.
 * GET/POST /auth/agent-tokens, DELETE /auth/agent-tokens/:id.
 */
export function ClaudeConnections() {
  const api = useApi();
  const tokens = useApiQuery((client) => client.agentTokens.list());
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateAgentTokenResponse | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  useSessionGuard(tokens.error, actionError);

  const list = tokens.data ?? [];
  const full = list.length >= MAX_AGENT_TOKENS;

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    if (!name || creating) return;
    setCreating(true);
    setActionError(null);
    try {
      setCreated(await api.agentTokens.create({ label: name }));
      setLabel('');
      tokens.reload();
    } catch (error) {
      setActionError(error);
    } finally {
      setCreating(false);
    }
  };

  const handleRemove = async (token: AgentTokenSummary) => {
    setRemoving(token.id);
    setActionError(null);
    try {
      await api.agentTokens.revoke(token.id);
      if (created?.id === token.id) setCreated(null);
      tokens.reload();
    } catch (error) {
      setActionError(error);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className={styles.connections}>
      {created && <NewToken token={created} onDone={() => setCreated(null)} />}

      {tokens.status === 'loading' && (
        <p className={styles.muted} role="status">
          Loading your connections…
        </p>
      )}
      {tokens.status === 'error' && (
        <div className={styles.row}>
          <Alert tone="error">
            {loadErrorMessage(tokens.error, 'We could not load your Claude connections.')}
          </Alert>
          <Button variant="secondary" onClick={tokens.reload}>
            Try again
          </Button>
        </div>
      )}

      {list.length > 0 && (
        <ul className={styles.list} aria-label="Claude connections">
          {list.map((token) => (
            <li key={token.id} className={styles.item}>
              <span className={styles.itemText}>
                <span className={styles.itemName}>{token.label}</span>
                <span className={styles.muted}>
                  Added {formatListDate(token.createdAt)}
                  {token.lastUsedAt
                    ? ` · last used ${formatListDate(token.lastUsedAt)}`
                    : ' · not used yet'}
                </span>
              </span>
              <Button
                variant="ghost"
                disabled={removing === token.id}
                onClick={() => void handleRemove(token)}
                aria-label={`Remove ${token.label}`}
              >
                {removing === token.id ? 'Removing…' : 'Remove'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {tokens.status === 'success' &&
        (full ? (
          <p className={styles.muted}>
            You have {MAX_AGENT_TOKENS} connections, the most allowed. Remove one to add another.
          </p>
        ) : (
          <form className={styles.form} onSubmit={(event) => void handleCreate(event)}>
            <Input
              label="Name this connection"
              hint="For example “Claude on my laptop”."
              value={label}
              maxLength={60}
              onChange={(event) => setLabel(event.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={creating || !label.trim()}>
              {creating ? 'Creating…' : 'Create connection'}
            </Button>
          </form>
        ))}

      {Boolean(actionError) && (
        <Alert tone="error">
          {flowErrorMessage(actionError, 'That did not work. Please try again.')}
        </Alert>
      )}
    </div>
  );
}

function NewToken({ token, onDone }: { token: CreateAgentTokenResponse; onDone: () => void }) {
  const [copied, setCopied] = useState<'token' | 'command' | 'failed' | null>(null);
  const command = claudeCodeCommand(token.token);

  const copy = async (text: string, what: 'token' | 'command') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied('failed');
    }
  };

  return (
    <section className={styles.newToken} aria-labelledby="new-claude-token">
      <h3 id="new-claude-token" className={styles.itemName}>
        “{token.label}” is ready
      </h3>
      <p className={styles.muted}>
        Copy it now: it is shown only once. Anyone with it can ask nurses and pay from your wallet
        within your Claude limit, so keep it private.
      </p>
      <code className={styles.code}>{token.token}</code>
      <div className={styles.row}>
        <Button variant="secondary" onClick={() => void copy(token.token, 'token')}>
          Copy token
        </Button>
        <Button variant="ghost" onClick={() => void copy(command, 'command')}>
          Copy Claude Code command
        </Button>
      </div>
      <p className={styles.muted} role="status">
        {copied === 'token' && 'Token copied.'}
        {copied === 'command' && 'Command copied. Paste it in your terminal.'}
        {copied === 'failed' && 'Could not copy. Select the token and copy it yourself.'}
      </p>
      <p className={styles.muted}>
        Claude Code: run the copied command. Claude Desktop: add CareLayer as an MCP server with
        this token (server {MCP_URL}).
      </p>
      <Button variant="ghost" onClick={onDone}>
        I’ve saved it
      </Button>
    </section>
  );
}
