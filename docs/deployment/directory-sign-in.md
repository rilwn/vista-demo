# Directory sign-in setup

Directory sign-in is optional and disabled by default. Choose one provider for
the shared API: LDAP/Active Directory, OIDC (including Entra ID), or SAML 2.0.
Vista employee accounts must already exist. Directory groups can add only
existing Vista roles; they do not create accounts or permissions.

## Configure a provider

1. Register the API callback URL with the identity provider and enable the
   required email and group claims/attributes.
2. Add the provider values to the deployment secret store. Do not put real
   secrets in `.env.example`, source control, or browser configuration.
3. Set `DIRECTORY_AUTH_PROVIDER` to exactly one of `ldap`, `oidc`, or `saml`.
4. Set `DIRECTORY_GROUP_ROLE_MAPPINGS_JSON` to map exact provider group names
   to role codes that already exist in Vista. Example shape:

   ```json
   { "CN=Finance,OU=Groups,DC=example,DC=org": ["existing-finance-role"] }
   ```

5. Set `DIRECTORY_LOGIN_RETURN_URLS_JSON` to the exact HTTPS origin of each
   app that should offer sign-in. The keys are `operations`, `pos`, and
   `recovery`. Unlisted apps cannot start sign-in.
6. Deploy the API and run the sign-in checks below. Keep the provider disabled
   until its callback and group mapping pass with a test account.

### LDAP / Active Directory

Set `DIRECTORY_LDAP_URL`, `DIRECTORY_LDAP_BASE_DN`,
`DIRECTORY_LDAP_BIND_DN`, `DIRECTORY_LDAP_BIND_PASSWORD`, and a
`DIRECTORY_LDAP_USER_FILTER` containing `{email}`. Set the email, display-name,
and group attribute names when they differ from the defaults. Production
requires `ldaps://`.

### OIDC / Entra ID

Set `DIRECTORY_OIDC_ISSUER`, `DIRECTORY_OIDC_CLIENT_ID`,
`DIRECTORY_OIDC_CLIENT_SECRET`, and
`DIRECTORY_OIDC_CALLBACK_URL`. Register the exact callback URL
`/api/v1/auth/directory/oidc/callback` with the provider. Configure a verified
email claim and a groups claim in the ID token; override the claim names only
when the provider uses different names.

### SAML 2.0

Set `DIRECTORY_SAML_ENTRY_POINT`, `DIRECTORY_SAML_ISSUER`,
`DIRECTORY_SAML_CALLBACK_URL`, and `DIRECTORY_SAML_IDP_CERTIFICATE`. Give the
identity provider the service-provider metadata at
`/api/v1/auth/directory/saml/metadata`. Configure the email and groups
attributes when they differ from the defaults. Responses must be signed and
match an active Vista sign-in request.

## Emergency local access

1. Add only designated emergency administrators to
   `DIRECTORY_EMERGENCY_EMAILS` as a comma-separated allowlist.
2. Ensure each account has an active Vista password and a verified
   authenticator before enabling directory sign-in.
3. Keep the allowlist short and store the deployment values securely.
4. On sign-in, the person must choose **Emergency access**, enter their local
   password, a current authenticator code, and a reason of at least eight
   characters. Vista records the reason with the session and audit event.
5. Remove emergency access when the directory service is restored or the
   employee no longer needs it.

## Verify

- Confirm the sign-in options show the selected provider on each configured
  app and remain disabled on unlisted apps.
- Sign in with a pre-created employee account and verify its assigned Vista
  role and permissions. An unmapped group must grant no additional access.
- Verify that an unknown or disabled Vista employee cannot sign in, even when
  the external identity is valid.
- For an administrative or mapped-administrator account, verify that Vista
  requires its enrolled authenticator.
- Verify an invalid password, rejected provider response, expired callback,
  replayed callback, and reused return ticket are rejected.
- Exercise emergency access and confirm the reason appears in the protected
  audit record. Confirm an unlisted email, missing reason, or missing
  authenticator is rejected.
- Disable the provider and confirm local sign-in returns to its normal
  configuration.

Provider credentials, live directory availability, and production group
assignments must be supplied and verified in the target environment. Never use
a staging identity configuration as proof of production integration.
