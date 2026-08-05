const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare const entityIdBrand: unique symbol;

export type EntityId = string & { readonly [entityIdBrand]: true };

export function asEntityId(value: string): EntityId {
  if (!uuidPattern.test(value)) {
    throw new Error('Entity identifiers must be UUIDs');
  }

  return value as EntityId;
}
