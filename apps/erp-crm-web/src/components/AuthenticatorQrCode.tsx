import { toString } from 'qrcode';
import { useEffect, useState } from 'react';

export function AuthenticatorQrCode({ provisioningUri }: { provisioningUri: string }) {
  const [imageSource, setImageSource] = useState('');

  useEffect(() => {
    let current = true;
    void toString(provisioningUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      type: 'svg',
      width: 176,
    })
      .then((svg) => {
        if (current) setImageSource(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (current) setImageSource('');
      });
    return () => {
      current = false;
    };
  }, [provisioningUri]);

  return (
    <section className="authenticator-setup-qr" aria-label="Authenticator QR code">
      {imageSource ? (
        <img
          alt="Scan this QR code with your authenticator app"
          height="176"
          src={imageSource}
          width="176"
        />
      ) : (
        <div aria-live="polite" className="authenticator-setup-qr-placeholder">
          Preparing QR code…
        </div>
      )}
      <p>Scan this code with your authenticator app, then enter the current six-digit code.</p>
    </section>
  );
}
