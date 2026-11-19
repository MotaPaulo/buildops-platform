# Inventory module (Stage 1)

Stock receipts and issues, separated by company and cost center, with a consolidated view of the group.

## Scope

- [x] Data model: companies, cost centers, sites, warehouses and materials
- [x] Access roles: director, manager, storekeeper and foreman (RLS)
- [x] Immutable movements with negative-balance blocking
- [x] Transfers between sites and between companies, recording who authorized them
- [x] Balance per warehouse with minimum-stock alert (RPC `get_stock_balances`)
- [x] Storage bucket for invoice and material photos
- [x] App: login and balances screen
- [x] Master data for materials, warehouses and sites in the app
- [ ] Master data for cost centers and minimum stock in the app
- [x] Receipts, issues and adjustments from the phone, with a photo of the invoice or material
- [x] Transfer screen
- [ ] Balances by site, cost center and group consolidated
- [ ] Web dashboard with filters and Excel export
- [ ] Reading data from current systems (depends on Stage 0)
- [ ] User and membership management by the directors

## Rules

1. **Every movement has a company, warehouse and cost center.** The warehouse and cost center must
   belong to the movement's company (enforced by composite foreign keys).
2. **Physical balance is per warehouse and material.** The cost center says who the receipt or
   consumption is charged to.
3. **No issue without balance.** The database rejects issues, transfers and negative adjustments that
   would leave the warehouse below zero.
4. **History is never edited.** There is no `update` or `delete` on `stock_movements`. Mistakes are
   corrected with an inventory adjustment, made by a manager or director.
5. **A transfer creates two movements** (`transfer_out` at the source and `transfer_in` at the
   destination) linked to the same row in `transfers`. Within a company the manager authorizes;
   between companies, a director. The authorizer needs access to both cost centers, and inactive
   warehouses or materials can't be used.
6. **Imported data is never duplicated.** The pair `external_system` + `external_ref` is unique.
7. **A warehouse tied to a site belongs to the site's company** (composite foreign key).
8. **A material's unit is fixed once it has movements.** Otherwise "40 sc" in the history would
   silently become "40 kg". To fix the catalog, create a new material and deactivate the old one.
9. **Master data is deactivated, not deleted.** Inactive materials and warehouses, and finished sites,
   stay in the history but no longer appear when recording movements.

## Master data in the app

"Cadastros" on the balances screen, shown only to roles that can edit something:

| Screen | Who edits | Notes |
| --- | --- | --- |
| Materials | director, manager, storekeeper | Group-wide catalog. SKU is optional, unique and stored uppercase. Category suggestions come from existing materials. |
| Warehouses | director, manager and storekeeper of the company | Optionally tied to a site; choosing a site suggests the name "Canteiro {site}". |
| Sites | director, manager of the company | Requires an active cost center. Creating a site can also create its site warehouse. |

The company of a warehouse or site can't change after it's created: its movements already belong to
that company.

RLS hides rows a user can't change, so an `update` that matches no rows is a denial, not an error.
The forms check the number of rows returned and report it.

## Recording movements in the app

The "Nova movimentação" (new movement) screen only offers the kinds, warehouses and cost centers the
user's role allows (rules mirrored from `can_register_movement` in `packages/shared`). The database
still has the final say.

- A site warehouse pre-selects that site's cost center.
- Quantities follow Brazilian notation: `1.500` = one thousand five hundred, `2,5` = two and a half.
  The screen shows the parsed value before saving.
- The photo is uploaded before the movement is inserted. If the database rejects the movement, the
  photo is deleted.
- Tapping a balance opens the form with the warehouse and material already filled in.

## Transfers in the app

Managers and directors see "Transferência" among the kinds on the new movement screen. The
transfer form:

- Origin: only warehouses of companies where the user authorizes transfers, and only materials
  with stock there (the balance is shown on each option).
- Destination: other warehouses. Managers see their company's; directors also see other
  companies', with a warning that the transfer is between companies.
- Cost centers at both ends default to the site's cost center when the warehouse belongs to a site.
- The user who submits is recorded as the authorizer (`transfers.authorized_by`). There is no
  separate approval step yet.

## Photos

Private bucket `movement-photos`, with path `{company_id}/{year}/{month}/{uuid}.jpg`. Only users with
access to the company can upload or view its photos. The path is stored in `stock_movements.photo_path`.

The uploader can delete a photo only while no movement references it. Once attached, a photo is as
immutable as the movement history.

## To validate in Stage 0

- Whether balance should also be tracked per cost center (stock "reserved" for a site), in addition
  to the warehouse's physical balance.
- The actual list of cost centers and sites for each company, with the finance team.
- Units of measure and material categories used today in each system.
- Whether the average material cost should be computed in the app or read from current systems.
