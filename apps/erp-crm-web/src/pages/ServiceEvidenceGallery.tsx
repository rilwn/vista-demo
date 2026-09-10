import { useEffect, useState } from 'react';
import { Button } from '@vista/ui';
import type { ServiceWorkOrder } from '@vista/contracts';
import { fetchServicePhoto, fetchServiceSignature } from '../api/service';
import { serviceEvidenceText as text } from './service-evidence.messages';
import './service-evidence.css';

export function ServiceEvidenceGallery({
  token,
  workOrder,
}: {
  token: string;
  workOrder: Pick<ServiceWorkOrder, 'id' | 'photos' | 'signature'>;
}) {
  return (
    <div className="service-evidence-gallery">
      {workOrder.photos.map((photo) => (
        <EvidenceImage
          key={`${token}:${workOrder.id}:${photo.id}`}
          token={token}
          workOrderId={workOrder.id}
          photoId={photo.id}
          name={photo.fileName}
          alt={text.photo(photo.fileName)}
        />
      ))}
      {workOrder.signature ? (
        <EvidenceImage
          key={`${token}:${workOrder.id}:${workOrder.signature.signedAt}`}
          token={token}
          workOrderId={workOrder.id}
          name="customer-signature.png"
          alt={text.signature(workOrder.signature.signerName)}
          caption={text.signatureCaption(workOrder.signature.signerName)}
        />
      ) : null}
    </div>
  );
}

function EvidenceImage({
  token,
  workOrderId,
  photoId,
  name,
  alt,
  caption,
}: {
  token: string;
  workOrderId: string;
  photoId?: string;
  name: string;
  alt: string;
  caption?: string;
}) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setFailed(false);
    void (
      photoId
        ? fetchServicePhoto(token, workOrderId, photoId)
        : fetchServiceSignature(token, workOrderId)
    )
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, workOrderId, photoId, revision]);
  return (
    <figure className={photoId ? undefined : 'service-evidence-signature'}>
      {url && !failed ? (
        <img src={url} alt={alt} onError={() => setFailed(true)} />
      ) : (
        <div className="service-evidence-placeholder" role={failed ? 'alert' : 'status'}>
          {failed ? text.unavailable : text.loading}
        </div>
      )}
      <figcaption title={caption ?? name}>{caption ?? name}</figcaption>
      {failed ? (
        <Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>
          {text.retry}
        </Button>
      ) : url ? (
        <a className="service-evidence-download" href={url} download={name}>
          {text.download}
        </a>
      ) : null}
    </figure>
  );
}
