import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JPEG_BYTES, pdfFile, renderApp, signIn, testApi } from '../../test/render-app';

async function openDocuments() {
  const api = testApi();
  await signIn(api, 'new@example.com', 'Ngozi Eze');
  await api.nurse.updateProfile({
    role: 'nurse',
    fullNameConfirmed: true,
    licenceNumber: 'RN 1',
    yearsOfPractice: 2,
  });
  const utils = renderApp(api, '/onboarding/documents');
  await screen.findByRole('heading', { name: 'Upload your documents' });
  return { api, ...utils };
}

const input = (title: RegExp) => screen.getByLabelText(title) as HTMLInputElement;
const choose = async (title: RegExp, file: File) => {
  await act(async () => {
    fireEvent.change(input(title), { target: { files: [file] } });
  });
};

describe('N03 Documents', () => {
  it('shows four rows; the selfie opens the front camera', async () => {
    await openDocuments();
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Documents' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(input(/Take a Selfie/).getAttribute('capture')).toBe('user');
    expect(input(/Government ID/).getAttribute('accept')).toContain('application/pdf');
    expect(screen.getByText('Stored encrypted. Never shown to the women you help.')).toBeTruthy();
  });

  it('uploads as soon as she picks a file, then shows it as uploaded', async () => {
    const { api } = await openDocuments();
    const upload = vi.spyOn(api.nurse, 'uploadDocument');
    await choose(/Current practising licence/, pdfFile('licence_2026.pdf'));
    await screen.findByText('Uploaded, licence_2026.pdf');
    expect(upload).toHaveBeenCalledWith('practising_licence', expect.any(File));
    expect(screen.getByRole('button', { name: 'Remove current practising licence' })).toBeTruthy();
  });

  it('refuses the wrong kind of file before uploading', async () => {
    const { api } = await openDocuments();
    const upload = vi.spyOn(api.nurse, 'uploadDocument');
    await choose(/Government ID/, new File(['x'], 'notes.docx', { type: 'application/msword' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'Upload a PDF or a photo (JPEG, PNG, WebP or HEIC).',
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it('shows the server’s message when the bytes are not a real PDF or photo', async () => {
    await openDocuments();
    await choose(
      /Government ID/,
      new File(['not really a pdf'], 'id.pdf', { type: 'application/pdf' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Upload a PDF or a photo (JPEG, PNG, WebP or HEIC).');
    expect(input(/Government ID/).getAttribute('aria-invalid')).toBe('true');
  });

  it('a failed upload can be tried again', async () => {
    const { api } = await openDocuments();
    vi.spyOn(api.nurse, 'uploadDocument').mockRejectedValueOnce(
      Object.assign(new Error('x'), { status: 0, code: 'INTERNAL' }),
    );
    await choose(/Certificate of registration/, pdfFile('cert.pdf'));
    await screen.findByRole('alert');
    await choose(/Certificate of registration/, pdfFile('cert.pdf'));
    await screen.findByText('Uploaded, cert.pdf');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Remove deletes the file and the row asks for it again', async () => {
    const { api } = await openDocuments();
    await choose(/Government ID/, pdfFile('nin.pdf'));
    await screen.findByText('Uploaded, nin.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Remove government id' }));
    await screen.findByText('NIN slip, passport or driver’s licence');
    expect((await api.nurse.getProfile()).documents).toHaveLength(0);
  });

  it('Continue needs all four, then goes to Step 3', async () => {
    const { router } = await openDocuments();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert').textContent).toMatch(/all four documents/);

    const selfie = new File([JPEG_BYTES], 'selfie.jpg', { type: 'image/jpeg' });
    await choose(/Current practising licence/, pdfFile('licence.pdf'));
    await choose(/Certificate of registration/, pdfFile('cert.pdf'));
    await choose(/Government ID/, pdfFile('nin.pdf'));
    await choose(/Take a Selfie/, selfie);
    await waitFor(() => expect(screen.getAllByText(/^Uploaded, /)).toHaveLength(4));
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Check and send' });
    expect(router.state.location.pathname).toBe('/onboarding/submit');
  });
});
