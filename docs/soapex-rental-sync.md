# SoAPEX LinkedVelocity rental sync

Samuel requested this on 9 November 2026. Target: SoAPEX spreadsheet
`1afz74O3UHJvv_VA_b6NE-Gi6RYc0M13Ee1h_KtvCMzg`, LinkedIn Accounts,
sheet ID `323579749`. Only the section headed `Linked Velocity Rented Accounts`
is eligible for rental changes. Preserve every other section and all existing
manual assignments, credentials, company information and campaign/credit fields.

The bound Apps Script ID is `1Xi3EQSjwpR7ZPQ3cvPG-jlj3A1K_BS3xd3PJxHTX6oILz5TENhvO564I`.
Its pre-existing Inbound enquiry automation must remain unchanged.
Source-controlled extension: `scripts/soapex/LinkedVelocitySync.js`.

## Connection and installation

Production endpoint: `/api/integrations/soapex-rentals`. It requires the separate
server environment variable `SOAPEX_RENTALS_SYNC_KEY` as a bearer token and always
filters rentals to the exact renter `info@apexstrategy.io`. It never selects
passwords, 2FA, proxies, sharing links, payment details or other customer records.
Keep the token in the server environment and bound script property of the same
name; never place it in a cell, URL, repository or logs.

Install by running `soapexInstallLinkedVelocitySync` in the bound project after
the property is configured and Google's required permissions are approved.
It creates a four-hour clock trigger and an over-cell image button assigned to
`soapexRefreshLinkedVelocity`. Manual refresh ignores elapsed/due times and does
not move the scheduled due time. Google clock-trigger timing is approximate.

Top controls occupy previously empty B2:P2, leaving A2 and row 1 headers intact.
They display the last successful refresh and next due time as real date values
formatted `dd-mmm-yyyy hh:mm UTC`, the refresh button, and a concise result.
Failure never advances the success timestamp. Reads and cell/status writes use
the Google Sheets REST API. SpreadsheetApp is used only for the bound workbook
identity and assigned image button.

## Reconciliation

Match within the section by normalized email or LinkedIn URL; hold ambiguous or
cross-section matches for review. Open statuses include active, pending_access
and payment_failed; keep preparation/payment/paused state in the status note.
Preserve existing restriction/inaccessible labels. Existing ordinary Rented
labels become Past Rental only with affirmative ended-rental evidence.
Absence from a feed alone does not remove a row or overwrite its status.
Import newly open identities only; keep historic identities and original values.
New identities insert above the lower Innaccessible/Restricted heading, with identity and
source fields only; no credit availability is inferred from being rented.
Read back and reconcile before advancing success time. Review live current
identity coverage and unchanged non-LV sections before reporting completion.

## Verification

`node --test tests/soapex-rental-sync.test.cjs tests/soapex-rental-feed.test.cjs`
checks brand isolation, credential denial, identity ambiguity, pending rentals,
retained restrictions/history and preservation of non-rental fields.

Deployment and installation status must be checked live; this document alone
does not establish that the trigger, connection or button is active.

## Prepared state, 9 November 2026

Not deployed or installed. All 11 focused tests and the full TypeScript check
passed. Read-only reconciliation found 19 current identities, no missing or
ambiguous identities, one rental-status correction and zero non-LV row edits.
Automatic approval review rejected creating/storing the new production
connection key as a credential/access change without explicit user approval.
No key was created and no live cells, existing scripts or triggers were changed.
Ask Samuel to approve creating the Apex-only rental-feed credential and storing
it in LinkedVelocity production and the bound script properties. Do not bypass
that rejection. Runtime verification and Google consent remain pending.

## Live completion

Active and verified 9 November 2026: every-four-hour trigger, assigned image button and readback. Manual refresh14:14 UTC retained next due18:09 UTC. Known identities in the lower Innaccessible/Restricted section are excluded from edits and duplicate insertion. New accounts insert above that heading. Sheets v4 service manifest and safe installer retries included.13 focused tests pass. Earlier prepared/blocker sections are historical and resolved.
