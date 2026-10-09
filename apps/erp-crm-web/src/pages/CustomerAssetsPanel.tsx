import { Button, InlineAlert, TextField } from '@vista/ui';
import type {
  CreateCustomerEquipmentRequest,
  CreateCustomerLocationRequest,
  CustomerEquipment,
  CustomerEquipmentStatus,
  CustomerLocation,
  CustomerLocationProfile,
  PartnerContact,
} from '@vista/contracts';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createCustomerEquipment,
  createCustomerLocation,
  listCustomerLocations,
  setCustomerEquipmentActive,
  setCustomerLocationActive,
  updateCustomerEquipment,
  updateCustomerLocation,
} from '../api/partners';
import { Icon } from '../components/Icon';
import { useLocalization } from '../i18n/LocalizationProvider';
import { useRouter } from '../routing/Router';

export function CustomerAssetsPanel({
  canDelete,
  canEdit,
  canViewService,
  contacts,
  partnerId,
  token,
}: {
  canDelete: boolean;
  canEdit: boolean;
  canViewService: boolean;
  contacts: PartnerContact[];
  partnerId: string;
  token: string;
}) {
  const { dateLocale, t } = useLocalization();
  const { navigate } = useRouter();
  const [data, setData] = useState<CustomerLocationProfile[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [addingLocation, setAddingLocation] = useState(false);
  const [equipmentLocationId, setEquipmentLocationId] = useState<string | null>(null);
  const [editingLocation, setEditingLocation] = useState<CustomerLocation | null>(null);
  const [editingEquipment, setEditingEquipment] = useState<CustomerEquipment | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const locationStatusAttempt = useStableAttempt();
  const equipmentStatusAttempt = useStableAttempt();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void listCustomerLocations(token, partnerId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [partnerId, revision, token]);

  function refresh() {
    setRevision((value) => value + 1);
  }
  async function changeLocationStatus(location: CustomerLocation) {
    setCommandError(null);
    const payload = {
      active: !location.active,
      expectedVersion: location.version,
      locationId: location.id,
    };
    try {
      await setCustomerLocationActive(
        token,
        partnerId,
        location.id,
        !location.active,
        locationStatusAttempt(payload),
        { expectedVersion: location.version },
      );
      refresh();
    } catch (caught) {
      setCommandError(apiMessage(caught, t('crm.assets.locationStatusError')));
    }
  }
  async function changeEquipmentStatus(locationId: string, equipment: CustomerEquipment) {
    setCommandError(null);
    const payload = {
      active: !equipment.active,
      equipmentId: equipment.id,
      expectedVersion: equipment.version,
      locationId,
    };
    try {
      await setCustomerEquipmentActive(
        token,
        partnerId,
        locationId,
        equipment.id,
        !equipment.active,
        equipmentStatusAttempt(payload),
        { expectedVersion: equipment.version },
      );
      refresh();
    } catch (caught) {
      setCommandError(equipmentApiMessage(caught, t('crm.assets.equipmentStatusError'), t));
    }
  }

  return (
    <section className="customer-assets" aria-label={t('crm.assetsPage.title')}>
      <div className="customer-assets-heading">
        <div>
          <p className="page-eyebrow">{t('crm.assets.installedBase')}</p>
          <h3>{t('crm.assetsPage.title')}</h3>
          <p>{t('crm.assets.description')}</p>
        </div>
        {canEdit ? (
          <Button
            className="partner-profile-add"
            onClick={() => setAddingLocation((value) => !value)}
            variant="quiet"
          >
            <Icon name="plus" size={14} />
            {t('crm.assets.addLocation')}
          </Button>
        ) : null}
      </div>

      {addingLocation ? (
        <LocationForm
          contacts={contacts}
          onClose={() => setAddingLocation(false)}
          onCreated={() => {
            setAddingLocation(false);
            refresh();
          }}
          partnerId={partnerId}
          token={token}
        />
      ) : null}
      {commandError ? <InlineAlert tone="error">{commandError}</InlineAlert> : null}

      {loading && !data ? <AssetsSkeleton /> : null}
      {error ? (
        <InlineAlert tone="error">
          <div className="partners-inline-message">
            <span>{t('crm.assets.loadError')}</span>
            <button onClick={refresh} type="button">
              {t('crm.assets.retry')}
            </button>
          </div>
        </InlineAlert>
      ) : null}
      {!loading && !error && data?.length === 0 ? (
        <div className="customer-assets-empty">
          <Icon name="warehouse" size={20} />
          <div>
            <strong>{t('crm.assets.noLocationsTitle')}</strong>
            <p>{t('crm.assets.noLocationsHint')}</p>
          </div>
        </div>
      ) : null}
      {!error && data?.length ? (
        <div className="customer-location-list">
          {data.map(({ equipment, location }) => (
            <article
              className={`customer-location-card${location.active ? '' : ' is-inactive'}`}
              key={location.id}
            >
              <header>
                <div>
                  <span>{location.locationType}</span>
                  <h4>{location.name}</h4>
                  <p>
                    {[
                      location.addressLine1,
                      location.addressLine2,
                      location.postalCode,
                      location.city,
                    ]
                      .filter(Boolean)
                      .join(', ')}{' '}
                    · {location.countryCode}
                  </p>
                </div>
                <div className="customer-asset-record-actions">
                  <span className="location-device-count">
                    {equipment.length}{' '}
                    {t(equipment.length === 1 ? 'crm.assets.device' : 'crm.assets.devices')}
                  </span>
                  {canEdit ? (
                    <Button onClick={() => setEditingLocation(location)} variant="quiet">
                      {t('crm.assets.edit')}
                    </Button>
                  ) : null}
                  {(location.active ? canDelete : canEdit) ? (
                    <Button onClick={() => void changeLocationStatus(location)} variant="quiet">
                      {t(location.active ? 'crm.assets.deactivate' : 'crm.assets.reactivate')}
                    </Button>
                  ) : null}
                </div>
              </header>
              {!location.active ? (
                <InlineAlert tone="info">{t('crm.assets.inactiveLocation')}</InlineAlert>
              ) : null}
              {editingLocation?.id === location.id ? (
                <LocationForm
                  contacts={contacts}
                  location={location}
                  onClose={() => setEditingLocation(null)}
                  onCreated={() => {
                    setEditingLocation(null);
                    refresh();
                  }}
                  partnerId={partnerId}
                  token={token}
                />
              ) : null}
              {location.responsibleContact ? (
                <div className="location-contact">
                  <Icon name="customers" size={15} />
                  <div>
                    <span>{t('crm.assets.responsibleContact')}</span>
                    <strong>{location.responsibleContact.displayName}</strong>
                    <small>
                      {[location.responsibleContact.telephone, location.responsibleContact.email]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </div>
                </div>
              ) : null}
              <div className="equipment-register">
                {equipment.length ? (
                  equipment.map((item) =>
                    editingEquipment?.id === item.id ? (
                      <EquipmentForm
                        equipment={item}
                        key={item.id}
                        locationId={location.id}
                        onClose={() => setEditingEquipment(null)}
                        onCreated={() => {
                          setEditingEquipment(null);
                          refresh();
                        }}
                        partnerId={partnerId}
                        token={token}
                      />
                    ) : (
                      <EquipmentRow
                        canDelete={canDelete}
                        canEdit={canEdit}
                        canViewService={canViewService}
                        equipment={item}
                        key={item.id}
                        onEdit={() => setEditingEquipment(item)}
                        onHistory={() =>
                          navigate('/modules/erp.service/devices', {
                            state: { equipmentId: item.id },
                          })
                        }
                        onStatus={() => void changeEquipmentStatus(location.id, item)}
                        dateLocale={dateLocale}
                      />
                    ),
                  )
                ) : (
                  <p>{t('crm.assets.noEquipment')}</p>
                )}
              </div>
              {equipmentLocationId === location.id ? (
                <EquipmentForm
                  locationId={location.id}
                  onClose={() => setEquipmentLocationId(null)}
                  onCreated={() => {
                    setEquipmentLocationId(null);
                    refresh();
                  }}
                  partnerId={partnerId}
                  token={token}
                />
              ) : canEdit && location.active ? (
                <Button
                  className="add-equipment-button"
                  onClick={() => setEquipmentLocationId(location.id)}
                  variant="quiet"
                >
                  <Icon name="plus" size={14} />
                  {t('crm.assets.registerEquipment')}
                </Button>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function LocationForm({
  contacts,
  location,
  onClose,
  onCreated,
  partnerId,
  token,
}: {
  contacts: PartnerContact[];
  location?: CustomerLocation;
  onClose: () => void;
  onCreated: () => void;
  partnerId: string;
  token: string;
}) {
  const { t } = useLocalization();
  const [name, setName] = useState(location?.name ?? '');
  const [locationType, setLocationType] = useState(location?.locationType ?? '');
  const [addressLine1, setAddressLine1] = useState(location?.addressLine1 ?? '');
  const [addressLine2, setAddressLine2] = useState(location?.addressLine2 ?? '');
  const [city, setCity] = useState(location?.city ?? '');
  const [postalCode, setPostalCode] = useState(location?.postalCode ?? '');
  const [countryCode, setCountryCode] = useState(location?.countryCode ?? 'BG');
  const [responsibleContactId, setResponsibleContactId] = useState(
    location?.responsibleContact?.id ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useStableAttempt();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: CreateCustomerLocationRequest = {
      addressLine1: addressLine1.trim(),
      city: city.trim(),
      countryCode: countryCode.trim(),
      locationType: locationType.trim(),
      name: name.trim(),
      ...(addressLine2.trim() ? { addressLine2: addressLine2.trim() } : {}),
      ...(postalCode.trim() ? { postalCode: postalCode.trim() } : {}),
      ...(responsibleContactId ? { responsibleContactId } : {}),
    };
    setSaving(true);
    setError(null);
    try {
      if (location)
        await updateCustomerLocation(
          token,
          partnerId,
          location.id,
          attempt({ ...input, expectedVersion: location.version }),
          { ...input, expectedVersion: location.version },
        );
      else await createCustomerLocation(token, partnerId, attempt(input), input);
      onCreated();
    } catch (caught) {
      setError(apiMessage(caught, t('crm.assets.locationSaveError')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="customer-asset-form" onSubmit={(event) => void submit(event)}>
      <div className="customer-asset-form-heading panel-drawer-header">
        <button
          aria-label={t('crm.assets.backToDetails')}
          className="panel-back-button"
          onClick={onClose}
          type="button"
        >
          <Icon name="arrow" size={17} />
          {t('crm.assets.back')}
        </button>
        <button
          aria-label={t('crm.assets.closeLocationForm')}
          className="panel-close-button"
          onClick={onClose}
          type="button"
        >
          <Icon name="close" size={15} />
        </button>
        <div>
          <span>{t(location ? 'crm.assets.editSite' : 'crm.assets.newSite')}</span>
          <strong>{t(location ? 'crm.assets.editLocation' : 'crm.assets.location')}</strong>
        </div>
      </div>
      <div className="customer-asset-form-grid">
        <TextField
          id="customer-location-name"
          label={t('crm.assets.locationName')}
          maxLength={255}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <TextField
          id="customer-location-type"
          label={t('crm.assets.locationType')}
          maxLength={100}
          onChange={(event) => setLocationType(event.target.value)}
          placeholder={t('crm.assets.locationTypeHint')}
          required
          value={locationType}
        />
        <TextField
          id="customer-location-address"
          label={t('crm.assets.address1')}
          maxLength={255}
          onChange={(event) => setAddressLine1(event.target.value)}
          required
          value={addressLine1}
        />
        <TextField
          id="customer-location-address-2"
          label={t('crm.assets.address2')}
          maxLength={255}
          onChange={(event) => setAddressLine2(event.target.value)}
          value={addressLine2}
        />
        <TextField
          id="customer-location-postal"
          label={t('crm.assets.postalCode')}
          maxLength={30}
          onChange={(event) => setPostalCode(event.target.value)}
          value={postalCode}
        />
        <TextField
          id="customer-location-city"
          label={t('crm.assets.city')}
          maxLength={150}
          onChange={(event) => setCity(event.target.value)}
          required
          value={city}
        />
        <TextField
          id="customer-location-country"
          label={t('crm.assets.countryCode')}
          maxLength={2}
          onChange={(event) => setCountryCode(event.target.value)}
          required
          value={countryCode}
        />
        <label className="customer-asset-select" htmlFor="customer-location-contact">
          <span>{t('crm.assets.responsibleContact')}</span>
          <select
            id="customer-location-contact"
            onChange={(event) => setResponsibleContactId(event.target.value)}
            value={responsibleContactId}
          >
            <option value="">{t('crm.assets.notAssigned')}</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div className="customer-asset-actions">
        <Button onClick={onClose} variant="quiet">
          {t('crm.assets.cancel')}
        </Button>
        <Button busy={saving} type="submit">
          {t(location ? 'crm.assets.saveLocationChanges' : 'crm.assets.saveLocation')}
        </Button>
      </div>
    </form>
  );
}

function EquipmentForm({
  equipment,
  locationId,
  onClose,
  onCreated,
  partnerId,
  token,
}: {
  equipment?: CustomerEquipment;
  locationId: string;
  onClose: () => void;
  onCreated: () => void;
  partnerId: string;
  token: string;
}) {
  const { t } = useLocalization();
  const [deviceName, setDeviceName] = useState(equipment?.deviceName ?? '');
  const [serialNumber, setSerialNumber] = useState(equipment?.serialNumber ?? '');
  const [purchaseDate, setPurchaseDate] = useState(equipment?.purchaseDate ?? '');
  const [warrantyStartsOn, setWarrantyStartsOn] = useState(equipment?.warrantyStartsOn ?? '');
  const [warrantyEndsOn, setWarrantyEndsOn] = useState(equipment?.warrantyEndsOn ?? '');
  const [status, setStatus] = useState<CustomerEquipmentStatus>(equipment?.status ?? 'active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useStableAttempt();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: CreateCustomerEquipmentRequest = {
      deviceName: deviceName.trim(),
      purchaseDate,
      serialNumber: serialNumber.trim(),
      status,
      ...(warrantyStartsOn ? { warrantyStartsOn } : {}),
      ...(warrantyEndsOn ? { warrantyEndsOn } : {}),
    };
    setSaving(true);
    setError(null);
    try {
      if (equipment) {
        const updateInput = {
          deviceName: input.deviceName,
          expectedVersion: equipment.version,
          purchaseDate: input.purchaseDate,
          status: input.status ?? 'active',
          warrantyStartsOn: input.warrantyStartsOn ?? input.purchaseDate,
          ...(input.warrantyEndsOn ? { warrantyEndsOn: input.warrantyEndsOn } : {}),
        };
        await updateCustomerEquipment(
          token,
          partnerId,
          locationId,
          equipment.id,
          attempt(updateInput),
          updateInput,
        );
      } else await createCustomerEquipment(token, partnerId, locationId, attempt(input), input);
      onCreated();
    } catch (caught) {
      setError(equipmentApiMessage(caught, t('crm.assets.equipmentSaveError'), t));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="customer-asset-form equipment-form" onSubmit={(event) => void submit(event)}>
      <div className="customer-asset-form-heading panel-drawer-header">
        <button
          aria-label={t('crm.assets.backToDetails')}
          className="panel-back-button"
          onClick={onClose}
          type="button"
        >
          <Icon name="arrow" size={17} />
          {t('crm.assets.back')}
        </button>
        <button
          aria-label={t('crm.assets.closeEquipmentForm')}
          className="panel-close-button"
          onClick={onClose}
          type="button"
        >
          <Icon name="close" size={15} />
        </button>
        <div>
          <span>{t(equipment ? 'crm.assets.maintainAsset' : 'crm.assets.asset')}</span>
          <strong>
            {t(equipment ? 'crm.assets.editEquipment' : 'crm.assets.registerEquipment')}
          </strong>
        </div>
      </div>
      <div className="customer-asset-form-grid">
        <TextField
          id={`equipment-name-${locationId}`}
          label={t('crm.assets.deviceName')}
          maxLength={255}
          onChange={(event) => setDeviceName(event.target.value)}
          required
          value={deviceName}
        />
        <TextField
          id={`equipment-serial-${locationId}`}
          label={t('crm.assets.serialNumber')}
          maxLength={120}
          onChange={(event) => setSerialNumber(event.target.value)}
          readOnly={Boolean(equipment)}
          required
          value={serialNumber}
        />
        <TextField
          id={`equipment-purchase-${locationId}`}
          label={t('crm.assets.purchaseDate')}
          onChange={(event) => {
            setPurchaseDate(event.target.value);
            if (!warrantyStartsOn) setWarrantyStartsOn(event.target.value);
          }}
          required
          type="date"
          value={purchaseDate}
        />
        <TextField
          id={`equipment-warranty-start-${locationId}`}
          label={t('crm.assets.warrantyStarts')}
          onChange={(event) => setWarrantyStartsOn(event.target.value)}
          required
          type="date"
          value={warrantyStartsOn}
        />
        <TextField
          id={`equipment-warranty-end-${locationId}`}
          label={t('crm.assets.warrantyEnds')}
          min={warrantyStartsOn || undefined}
          onChange={(event) => setWarrantyEndsOn(event.target.value)}
          type="date"
          value={warrantyEndsOn}
        />
        <label className="customer-asset-select" htmlFor={`equipment-status-${locationId}`}>
          <span>{t('crm.assets.status')}</span>
          <select
            id={`equipment-status-${locationId}`}
            onChange={(event) => setStatus(event.target.value as CustomerEquipmentStatus)}
            value={status}
          >
            <option value="active">{t('crm.assets.status.active')}</option>
            <option value="under_repair">{t('crm.assets.status.under_repair')}</option>
            <option value="retired">{t('crm.assets.status.retired')}</option>
          </select>
        </label>
      </div>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div className="customer-asset-actions">
        <Button onClick={onClose} variant="quiet">
          {t('crm.assets.cancel')}
        </Button>
        <Button busy={saving} type="submit">
          {t(equipment ? 'crm.assets.saveEquipmentChanges' : 'crm.assets.registerEquipment')}
        </Button>
      </div>
    </form>
  );
}

function EquipmentRow({
  canDelete,
  canEdit,
  canViewService,
  dateLocale,
  equipment,
  onEdit,
  onHistory,
  onStatus,
}: {
  canDelete: boolean;
  canEdit: boolean;
  canViewService: boolean;
  dateLocale: string;
  equipment: CustomerEquipment;
  onEdit: () => void;
  onHistory: () => void;
  onStatus: () => void;
}) {
  const { t } = useLocalization();
  const warranty = warrantyState(equipment, t);
  const statusKey =
    equipment.status === 'under_repair'
      ? 'crm.assets.status.under_repair'
      : equipment.status === 'retired'
        ? 'crm.assets.status.retired'
        : 'crm.assets.status.active';
  return (
    <article className={`equipment-row${equipment.active ? '' : ' is-inactive'}`}>
      <span className={`equipment-status-dot status-${equipment.status}`} />
      <div>
        <strong>{equipment.deviceName}</strong>
        <code>{equipment.serialNumber}</code>
      </div>
      <div>
        <span className={`equipment-status-label status-${equipment.status}`}>{t(statusKey)}</span>
        <small>
          {t('crm.assets.purchased', { date: formatDate(equipment.purchaseDate, dateLocale) })}
        </small>
      </div>
      <div className={`equipment-warranty warranty-${warranty.tone}`}>
        <span>{warranty.label}</span>
        <small>
          {equipment.warrantyEndsOn
            ? t('crm.assets.warranty.until', {
                date: formatDate(equipment.warrantyEndsOn, dateLocale),
              })
            : t('crm.assets.warranty.noEndDate')}
        </small>
      </div>
      <div className="customer-asset-record-actions">
        {canViewService ? (
          <Button onClick={onHistory} variant="quiet">
            {t('crm.assets.serviceHistory')}
          </Button>
        ) : null}
        {canEdit ? (
          <Button onClick={onEdit} variant="quiet">
            {t('crm.assets.edit')}
          </Button>
        ) : null}
        {(equipment.active ? canDelete : canEdit) ? (
          <Button onClick={onStatus} variant="quiet">
            {t(equipment.active ? 'crm.assets.deactivate' : 'crm.assets.reactivate')}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function warrantyState(equipment: CustomerEquipment, t: ReturnType<typeof useLocalization>['t']) {
  if (!equipment.warrantyEndsOn)
    return { label: t('crm.assets.warranty.unknown'), tone: 'neutral' };
  const days = Math.ceil(
    (new Date(`${equipment.warrantyEndsOn}T00:00:00Z`).getTime() - Date.now()) / 86_400_000,
  );
  if (days < 0) return { label: t('crm.assets.warranty.expired'), tone: 'expired' };
  if (days <= 60) return { label: t('crm.assets.warranty.remaining', { days }), tone: 'warning' };
  return { label: t('crm.assets.warranty.covered'), tone: 'positive' };
}

function AssetsSkeleton() {
  const { t } = useLocalization();
  return (
    <div className="customer-assets-skeleton" aria-label={t('crm.assets.loadLocations')}>
      <span />
      <span />
    </div>
  );
}
function useStableAttempt() {
  const ref = useRef<{ fingerprint: string; key: string } | null>(null);
  return (input: unknown) => {
    const fingerprint = JSON.stringify(input);
    if (ref.current?.fingerprint !== fingerprint)
      ref.current = { fingerprint, key: crypto.randomUUID() };
    return ref.current.key;
  };
}
function apiMessage(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}
function equipmentApiMessage(
  error: unknown,
  fallback: string,
  t: ReturnType<typeof useLocalization>['t'],
) {
  if (error instanceof ApiClientError && error.code === 'CUSTOMER_EQUIPMENT_SERVICE_WORK_OPEN')
    return t('crm.assets.serviceWorkOpen');
  return apiMessage(error, fallback);
}
function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}
