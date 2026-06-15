import type { Authorization, AuthorizationRequest, TypedDataDomain, TypedDataField } from 'ethers';

export type RelayAdapt7702AuthorizationRequest = AuthorizationRequest;

export type RelayAdapt7702TypedDataDomain = TypedDataDomain;

export type RelayAdapt7702TypedDataTypes = Record<string, readonly TypedDataField[]>;

export type RelayAdapt7702TypedDataValue = Record<string, unknown>;

export interface RelayAdapt7702HookedSigner {
  readonly address: string;

  populateAuthorization(
    request: RelayAdapt7702AuthorizationRequest,
  ): Promise<RelayAdapt7702AuthorizationRequest>;

  authorize(
    request: RelayAdapt7702AuthorizationRequest,
  ): Promise<Authorization>;

  signTypedData(
    domain: RelayAdapt7702TypedDataDomain,
    types: RelayAdapt7702TypedDataTypes,
    value: RelayAdapt7702TypedDataValue,
  ): Promise<string>;
}