// Picks one access (role, company, cost center) for a user. On-screen text is pt-BR.
import { APP_ROLES, ROLE_LABELS, type AccessInput, type AppRole } from '@buildops/shared';

import { Chips, Field } from '@/components/form';
import type { Org } from '@/lib/users';

const WHOLE_COMPANY = 'whole-company';

export function AccessPicker({
  value,
  onChange,
  org,
}: {
  value: AccessInput;
  onChange: (access: AccessInput) => void;
  org: Org;
}) {
  const costCenters = org.costCenters.filter((cc) => cc.company_id === value.company_id && cc.active);

  return (
    <>
      <Field label="Perfil">
        <Chips
          options={APP_ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r] }))}
          value={value.role}
          onChange={(id) => {
            const role = id as AppRole;
            onChange(role === 'director' ? { role, company_id: null, cost_center_id: null } : { ...value, role });
          }}
        />
      </Field>

      {value.role && value.role !== 'director' && (
        <Field label="Empresa">
          <Chips
            options={org.companies.map((c) => ({ id: c.id, label: c.name }))}
            value={value.company_id}
            onChange={(id) => onChange({ ...value, company_id: id, cost_center_id: null })}
          />
        </Field>
      )}

      {value.role && value.role !== 'director' && value.company_id && (
        <Field label="Centro de custo" hint="Sem centro de custo, o acesso vale para a empresa toda.">
          <Chips
            options={[
              { id: WHOLE_COMPANY, label: 'Empresa toda' },
              ...costCenters.map((cc) => ({ id: cc.id, label: `${cc.code} · ${cc.name}` })),
            ]}
            value={value.cost_center_id ?? WHOLE_COMPANY}
            onChange={(id) => onChange({ ...value, cost_center_id: id === WHOLE_COMPANY ? null : id })}
          />
        </Field>
      )}
    </>
  );
}

export const EMPTY_ACCESS: AccessInput = { role: null, company_id: null, cost_center_id: null };
