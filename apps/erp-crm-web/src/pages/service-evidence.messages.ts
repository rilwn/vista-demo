export const serviceEvidenceText = {
  loading: 'Loading image…',
  unavailable: 'This image could not be loaded.',
  retry: 'Try again',
  download: 'Download',
  refreshFailed: 'The Service list could not be refreshed. Your open record has been kept.',
  refresh: 'Refresh list',
  photo: (name: string) => `Service photo: ${name}`,
  signature: (name: string) => `Signature from ${name}`,
  signatureCaption: (name: string) => `Customer signature · ${name}`,
};
