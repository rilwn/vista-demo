import { toString } from 'qrcode';
import { useEffect, useState } from 'react';
import { translateLegacyText } from '../i18n/legacyPageCatalog';
import { useLocalization } from '../i18n/LocalizationProvider';

export function AuthenticatorQrCode({ provisioningUri }: { provisioningUri: string }) {
  const [imageSource, setImageSource] = useState('');
  const { locale } = useLocalization();
  const text = (value: string) => (locale === 'bg' ? translateLegacyText(value) : value);

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
    <section className="authenticator-setup-qr" aria-label={text('Authenticator QR code')}>
      {imageSource ? (
        <img
          alt={text('Scan this QR code with your authenticator app')}
          height="176"
          src={imageSource}
          width="176"
        />
      ) : (
        <div aria-live="polite" className="authenticator-setup-qr-placeholder">
          {text('Preparing QR code…')}
        </div>
      )}
      <p>
        {text('Scan this code with your authenticator app, then enter the current six-digit code.')}
      </p>
    </section>
  );
}
