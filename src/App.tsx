import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, Database, Filter, GitBranch, Link2, RefreshCw, Upload } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db } from "./db";
import { importCsv } from "./importer";
import { ensureDefaultStageMapping } from "./stageDefaults";
import { entitySummary, getFiltered, groupCount, kpis, lossReason, options, stageKind } from "./analytics";
import { FIELD, amountOf, responsibleOf, sourceOf, stageOf, titleOf } from "./fields";
import type { DashboardFilters, EntityLink, EntityType, StageMapping, StoredEntity } from "./types";

type MainTab = "leadFunnel" | "dealFunnel" | "through";
type Breakdown = "funnel" | "source" | "manager" | "project";

const COLORS = ["#1f4ed8", "#1890ff", "#52c41a", "#fa8c16", "#eb2f96", "#722ed1", "#607d8b"];
const BREAKDOWN_LABEL: Record<Breakdown, string> = {
  funnel: "Воронка",
  source: "Источники",
  manager: "Менеджеры",
  project: "Проекты",
};

const initialFilters: DashboardFilters = {
  periodFrom: "",
  periodTo: "",
  responsible: "",
  source: "",
  project: "",
  stage: "",
  linkState: "all",
};

function App() {
  const [active, setActive] = useState<MainTab>("leadFunnel");
  const [leadBreakdown, setLeadBreakdown] = useState<Breakdown>("funnel");
  const [dealBreakdown, setDealBreakdown] = useState<Breakdown>("funnel");
  const [leads, setLeads] = useState<StoredEntity[]>([]);
  const [deals, setDeals] = useState<StoredEntity[]>([]);
  const [links, setLinks] = useState<EntityLink[]>([]);
  const [mapping, setMapping] = useState<StageMapping[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [selected, setSelected] = useState<StoredEntity | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const data = useMemo(() => ({ leads, deals, links, mapping }), [leads, deals, links, mapping]);
  const filtered = useMemo(() => getFiltered(data, filters), [data, filters]);
  const stats = useMemo(() => kpis(data, filters), [data, filters]);
  const filterOptions = useMemo(() => options(data), [data]);
  const linkMap = useMemo(() => new Map(links.map((link) => [link.dealId, link])), [links]);

  async function refresh() {
    await ensureDefaultStageMapping();
    const [nextLeads, nextDeals, nextLinks, nextMapping] = await Promise.all([
      db.leads.toArray(),
      db.deals.toArray(),
      db.entityLinks.toArray(),
      db.stageMapping.toArray(),
    ]);
    setLeads(nextLeads);
    setDeals(nextDeals);
    setLinks(nextLinks);
    setMapping(nextMapping);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleImport(type: EntityType, file?: File) {
    if (!file) return;
    setBusy(`Загружаю ${type === "lead" ? "лиды" : "сделки"}...`);
    try {
      const result = await importCsv(type, file);
      setNotice(`Загружено ${result.importRun.rowCount}. Новых: ${result.importRun.inserted}, обновлено: ${result.importRun.updated}.`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить файл.");
    } finally {
      setBusy("");
    }
  }

  async function handleImportFromData(type: EntityType) {
    const path = type === "lead" ? "./data/leads.csv" : "./data/deals.csv";
    setBusy(`Загружаю ${type === "lead" ? "лиды" : "сделки"} из data...`);
    try {
      const response = await fetch(`${path}?t=${Date.now()}`);
      if (!response.ok) throw new Error(`Файл ${path} не найден.`);
      const blob = await response.blob();
      const file = new File([blob], type === "lead" ? "leads.csv" : "deals.csv", { type: "text/csv" });
      await handleImport(type, file);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить файл из data.");
      setBusy("");
    }
  }

  const leadStages = stageRows(filtered.leads, "lead", mapping);
  const dealStages = stageRows(filtered.deals, "deal", mapping);
  const lossData = groupCount(
    filtered.deals.filter((deal) => stageKind("deal", stageOf("deal", deal.raw), mapping) === "loss"),
    (deal) => lossReason("deal", stageOf("deal", deal.raw), mapping),
  );
  const linkData = groupCount(links, (link) => link.confidence);
  const throughSteps = [
    { name: "Поступило лидов", value: filtered.leads.length },
    { name: "Качественные лиды", value: filtered.leads.filter((lead) => stageKind("lead", stageOf("lead", lead.raw), mapping) === "success").length },
    { name: "Создано сделок", value: filtered.deals.length },
    { name: "Сделки в работе", value: filtered.deals.filter((deal) => stageKind("deal", stageOf("deal", deal.raw), mapping) === "work").length },
    { name: "Заключено договоров", value: filtered.deals.filter((deal) => stageKind("deal", stageOf("deal", deal.raw), mapping) === "success").length },
  ];

  return (
    <div className="app shell">
      <aside className="sidebar compact">
        <div className="brand">
          <BarChart3 size={26} />
          <div>
            <strong>Продажи</strong>
            <span>Bitrix dashboard</span>
          </div>
        </div>
        <nav>
          <button className={active === "leadFunnel" ? "active" : ""} onClick={() => setActive("leadFunnel")}>
            <BarChart3 size={18} /> Воронка по лидам
          </button>
          <button className={active === "dealFunnel" ? "active" : ""} onClick={() => setActive("dealFunnel")}>
            <BarChart3 size={18} /> Воронка по сделкам
          </button>
          <button className={active === "through" ? "active" : ""} onClick={() => setActive("through")}>
            <GitBranch size={18} /> Сквозная
          </button>
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>{active === "leadFunnel" ? "Воронка по лидам" : active === "dealFunnel" ? "Воронка по сделкам" : "Сквозная аналитика"}</h1>
            <p>Период, источники, менеджеры и проекты меняются общими фильтрами.</p>
          </div>
          <div className="upload-row">
            <label className="icon-button">
              <Upload size={18} /> Лиды CSV
              <input type="file" accept=".csv,text/csv" onChange={(e) => handleImport("lead", e.target.files?.[0])} />
            </label>
            <label className="icon-button">
              <Upload size={18} /> Сделки CSV
              <input type="file" accept=".csv,text/csv" onChange={(e) => handleImport("deal", e.target.files?.[0])} />
            </label>
            <button className="icon-button" onClick={() => handleImportFromData("lead")}>
              <Database size={18} /> Лиды из data
            </button>
            <button className="icon-button" onClick={() => handleImportFromData("deal")}>
              <Database size={18} /> Сделки из data
            </button>
          </div>
        </header>

        {(notice || busy) && (
          <div className="notice">
            {busy && <RefreshCw className="spin" size={16} />}
            {busy || notice}
          </div>
        )}

        <Filters filters={filters} setFilters={setFilters} selectOptions={filterOptions} />

        {active === "leadFunnel" && (
          <FunnelTab
            type="lead"
            rows={filtered.leads}
            stages={leadStages}
            breakdown={leadBreakdown}
            setBreakdown={setLeadBreakdown}
            mapping={mapping}
            onSelect={setSelected}
          />
        )}

        {active === "dealFunnel" && (
          <FunnelTab
            type="deal"
            rows={filtered.deals}
            stages={dealStages}
            breakdown={dealBreakdown}
            setBreakdown={setDealBreakdown}
            mapping={mapping}
            onSelect={setSelected}
            extra={<LossPanel lossData={lossData} />}
          />
        )}

        {active === "through" && (
          <ThroughTab
            stats={stats}
            steps={throughSteps}
            lossData={lossData}
            linkData={linkData}
            deals={filtered.deals}
            leads={leads}
            linkMap={linkMap}
            onSelect={setSelected}
          />
        )}
      </main>

      {selected && <EntityDrawer entity={selected} links={links} leads={leads} deals={deals} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Filters({
  filters,
  setFilters,
  selectOptions,
}: {
  filters: DashboardFilters;
  setFilters: (filters: DashboardFilters) => void;
  selectOptions: ReturnType<typeof options>;
}) {
  const set = (key: keyof DashboardFilters, value: string) => setFilters({ ...filters, [key]: value });
  return (
    <section className="filters report-filters">
      <Filter size={18} />
      <label>
        <span>От</span>
        <input type="date" value={filters.periodFrom} onChange={(e) => set("periodFrom", e.target.value)} />
      </label>
      <label>
        <span>До</span>
        <input type="date" value={filters.periodTo} onChange={(e) => set("periodTo", e.target.value)} />
      </label>
      <Select value={filters.source} onChange={(value) => set("source", value)} options={selectOptions.source} label="Источник" />
      <Select value={filters.responsible} onChange={(value) => set("responsible", value)} options={selectOptions.responsible} label="Менеджер" />
      <Select value={filters.project} onChange={(value) => set("project", value)} options={selectOptions.project} label="Проект" />
      <Select value={filters.stage} onChange={(value) => set("stage", value)} options={selectOptions.stage} label="Стадия" />
      <button onClick={() => setFilters(initialFilters)}>Сброс</button>
    </section>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function FunnelTab({
  type,
  rows,
  stages,
  breakdown,
  setBreakdown,
  mapping,
  onSelect,
  extra,
}: {
  type: EntityType;
  rows: StoredEntity[];
  stages: Array<{ name: string; value: number; kind: string }>;
  breakdown: Breakdown;
  setBreakdown: (value: Breakdown) => void;
  mapping: StageMapping[];
  onSelect: (entity: StoredEntity) => void;
  extra?: ReactNode;
}) {
  const groups = breakdownRows(rows, type, breakdown, mapping);
  const totalAmount = rows.reduce((sum, item) => sum + amountOf(item.raw), 0);
  return (
    <>
      <Segmented value={breakdown} onChange={setBreakdown} />
      <section className="kpi-grid compact-kpis">
        <Kpi title={type === "lead" ? "Всего лидов" : "Всего сделок"} value={rows.length} />
        <Kpi title="В работе" value={rows.filter((row) => stageKind(type, stageOf(type, row.raw), mapping) === "work").length} />
        <Kpi title="Успешно" value={rows.filter((row) => stageKind(type, stageOf(type, row.raw), mapping) === "success").length} />
        <Kpi title="Потери" value={rows.filter((row) => stageKind(type, stageOf(type, row.raw), mapping) === "loss").length} />
        <Kpi title="Сумма" value={formatMoney(totalAmount)} />
      </section>
      <section className="grid two">
        <Panel title={breakdown === "funnel" ? "Воронка" : BREAKDOWN_LABEL[breakdown]}>
          {breakdown === "funnel" ? <FunnelBars data={stages} /> : <HorizontalBars data={groups.slice(0, 14)} />}
        </Panel>
        <Panel title="Таблица среза">
          <PivotTable rows={rows} type={type} groupBy={breakdown} mapping={mapping} />
        </Panel>
        {extra}
        <Panel title={type === "lead" ? "Лиды" : "Сделки"} wide>
          <EntityTable rows={rows.slice(0, 120)} onSelect={onSelect} />
        </Panel>
      </section>
    </>
  );
}

function ThroughTab({
  stats,
  steps,
  lossData,
  linkData,
  deals,
  leads,
  linkMap,
  onSelect,
}: {
  stats: ReturnType<typeof kpis>;
  steps: Array<{ name: string; value: number }>;
  lossData: Array<{ name: string; value: number }>;
  linkData: Array<{ name: string; value: number }>;
  deals: StoredEntity[];
  leads: StoredEntity[];
  linkMap: Map<string, EntityLink>;
  onSelect: (entity: StoredEntity) => void;
}) {
  return (
    <>
      <section className="kpi-grid compact-kpis">
        <Kpi title="Лиды" value={stats.leads} />
        <Kpi title="Сделки" value={stats.deals} />
        <Kpi title="Уверенные связи" value={stats.strongLinks} hint={`${stats.linkRate}% сделок`} />
        <Kpi title="Конверсия" value={`${stats.conversion}%`} />
        <Kpi title="Сумма сделок" value={formatMoney(stats.amount)} />
      </section>
      <section className="grid two">
        <Panel title="Общая воронка продаж" wide>
          <SalesFunnel steps={steps} />
        </Panel>
        <LossPanel lossData={lossData} />
        <Panel title="Качество связки">
          <ResponsiveContainer width="100%" height={290}>
            <PieChart>
              <Pie data={linkData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={104}>
                {linkData.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
        <div className="panel warning-panel">
          <AlertTriangle size={24} />
          <h2>Сквозная аналитика</h2>
          <p>В основной конверсии учитываются только уверенные связи по телефону, email, DKT или roistat.</p>
          <div className="link-stats">
            {linkData.map((item) => (
              <span key={item.name}>
                {item.name}: <b>{item.value}</b>
              </span>
            ))}
          </div>
        </div>
        <Panel title="Связанные сделки" wide>
          <LinkedTable deals={deals} linkMap={linkMap} leads={leads} onSelect={onSelect} />
        </Panel>
      </section>
    </>
  );
}

function Segmented({ value, onChange }: { value: Breakdown; onChange: (value: Breakdown) => void }) {
  return (
    <div className="segment-tabs">
      {(Object.keys(BREAKDOWN_LABEL) as Breakdown[]).map((key) => (
        <button key={key} className={value === key ? "active" : ""} onClick={() => onChange(key)}>
          {BREAKDOWN_LABEL[key]}
        </button>
      ))}
    </div>
  );
}

function Kpi({ title, value, hint }: { title: string; value: number | string; hint?: string }) {
  return (
    <div className="kpi">
      <span>{title}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Panel({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`panel ${wide ? "wide" : ""}`}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function FunnelBars({ data }: { data: Array<{ name: string; value: number; kind: string }> }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="funnel-list">
      {data.map((item, index) => (
        <div className={`funnel-row ${item.kind}`} key={item.name}>
          <div>
            <b>{index + 1}. {item.name}</b>
            <span>{item.value}</span>
          </div>
          <i style={{ width: `${Math.max((item.value / max) * 100, 4)}%` }} />
        </div>
      ))}
    </div>
  );
}

function SalesFunnel({ steps }: { steps: Array<{ name: string; value: number }> }) {
  const first = steps[0]?.value || 0;
  return (
    <div className="sales-funnel">
      {steps.map((step, index) => {
        const prev = steps[index - 1]?.value || step.value;
        const fromStart = first ? Math.round((step.value / first) * 1000) / 10 : 0;
        const fromPrev = prev ? Math.round((step.value / prev) * 1000) / 10 : 0;
        return (
          <div key={step.name}>
            <strong>{step.value}</strong>
            <span>{step.name}</span>
            <small>{index === 0 ? "100%" : `${fromPrev}% от шага / ${fromStart}% от входа`}</small>
          </div>
        );
      })}
    </div>
  );
}

function HorizontalBars({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={330}>
      <BarChart data={data} layout="vertical" margin={{ left: 18, right: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} />
        <YAxis dataKey="name" type="category" width={210} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="value" fill="#1f4ed8" radius={[0, 5, 5, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function LossPanel({ lossData }: { lossData: Array<{ name: string; value: number }> }) {
  const total = lossData.reduce((sum, item) => sum + item.value, 0);
  return (
    <Panel title="Причины сливов / отказов">
      <div className="loss-table">
        {lossData.slice(0, 12).map((item) => (
          <div key={item.name}>
            <span>{item.name}</span>
            <b>{item.value}</b>
            <i style={{ width: `${total ? (item.value / total) * 100 : 0}%` }} />
            <em>{total ? `${Math.round((item.value / total) * 1000) / 10}%` : "0%"}</em>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function EntityTable({ rows, onSelect }: { rows: StoredEntity[]; onSelect: (entity: StoredEntity) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Название</th>
            <th>Стадия</th>
            <th>Менеджер</th>
            <th>Источник</th>
            <th>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const summary = entitySummary(row);
            return (
              <tr key={`${row.type}-${row.id}`} onClick={() => onSelect(row)}>
                <td>{row.id}</td>
                <td>{summary.title}</td>
                <td>{summary.stage}</td>
                <td>{summary.responsible}</td>
                <td>{summary.source}</td>
                <td>{formatMoney(summary.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PivotTable({ rows, type, groupBy, mapping }: { rows: StoredEntity[]; type: EntityType; groupBy: Breakdown; mapping: StageMapping[] }) {
  const stages = stageRows(rows, type, mapping).map((item) => item.name);
  const groups = pivotRows(rows, type, groupBy, stages);
  return (
    <div className="table-wrap pivot-wrap">
      <table>
        <thead>
          <tr>
            <th>{BREAKDOWN_LABEL[groupBy]}</th>
            <th>Всего</th>
            {stages.map((stage) => (
              <th key={stage}>{stage}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.name}>
              <td><b>{group.name}</b></td>
              <td>{group.total}</td>
              {stages.map((stage) => (
                <td key={stage}>{group.stages[stage] || ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinkedTable({
  deals,
  linkMap,
  leads,
  onSelect,
}: {
  deals: StoredEntity[];
  linkMap: Map<string, EntityLink>;
  leads: StoredEntity[];
  onSelect: (entity: StoredEntity) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Сделка</th>
            <th>Стадия</th>
            <th>Связь</th>
            <th>Лид</th>
            <th>Поля</th>
          </tr>
        </thead>
        <tbody>
          {deals.slice(0, 150).map((deal) => {
            const link = linkMap.get(deal.id);
            const lead = leads.find((item) => item.id === link?.leadId);
            return (
              <tr key={deal.id} onClick={() => onSelect(deal)}>
                <td>{titleOf("deal", deal.raw)}</td>
                <td>{stageOf("deal", deal.raw)}</td>
                <td><Link2 size={14} /> {link?.confidence || "none"}</td>
                <td>{lead ? `${lead.id} · ${titleOf("lead", lead.raw)}` : link?.candidateLeadIds.join(", ")}</td>
                <td>{link?.matchedFields.join(", ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EntityDrawer({
  entity,
  links,
  leads,
  deals,
  onClose,
}: {
  entity: StoredEntity;
  links: EntityLink[];
  leads: StoredEntity[];
  deals: StoredEntity[];
  onClose: () => void;
}) {
  const summary = entitySummary(entity);
  const relatedLinks = entity.type === "deal" ? links.filter((link) => link.dealId === entity.id) : links.filter((link) => link.leadId === entity.id);
  const relatedEntities =
    entity.type === "deal"
      ? relatedLinks.flatMap((link) => leads.filter((lead) => lead.id === link.leadId || link.candidateLeadIds.includes(lead.id)))
      : relatedLinks.flatMap((link) => deals.filter((deal) => deal.id === link.dealId));
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}>Закрыть</button>
        <h2>{summary.title}</h2>
        <div className="drawer-meta">
          <span>{entity.type === "lead" ? "Лид" : "Сделка"} #{entity.id}</span>
          <span>{summary.stage}</span>
          <span>{summary.responsible}</span>
        </div>
        <h3>Связанные записи</h3>
        {relatedEntities.length ? (
          relatedEntities.map((item) => (
            <div className="related" key={`${item.type}-${item.id}`}>
              <b>{item.type === "lead" ? "Лид" : "Сделка"} #{item.id}</b>
              <span>{titleOf(item.type, item.raw)}</span>
            </div>
          ))
        ) : (
          <p className="muted">Связи не найдены.</p>
        )}
        <h3>Поля Битрикса</h3>
        <div className="raw-fields">
          {Object.entries(entity.raw)
            .filter(([, raw]) => raw)
            .map(([field, raw]) => (
              <div key={field}>
                <span>{field}</span>
                <b>{raw}</b>
              </div>
            ))}
        </div>
      </aside>
    </div>
  );
}

function groupKey(row: StoredEntity, breakdown: Breakdown) {
  if (breakdown === "source") return sourceOf(row.raw);
  if (breakdown === "manager") return responsibleOf(row.raw);
  if (breakdown === "project") return row.raw[FIELD.project] || "Без проекта";
  return stageOf(row.type, row.raw);
}

function breakdownRows(rows: StoredEntity[], type: EntityType, breakdown: Breakdown, mapping: StageMapping[]) {
  if (breakdown === "funnel") return stageRows(rows, type, mapping);
  return groupCount(rows, (row) => groupKey(row, breakdown));
}

function pivotRows(rows: StoredEntity[], type: EntityType, breakdown: Breakdown, stages: string[]) {
  const map = new Map<string, { name: string; total: number; stages: Record<string, number> }>();
  rows.forEach((row) => {
    const name = groupKey(row, breakdown);
    const stage = stageOf(type, row.raw);
    const current = map.get(name) || { name, total: 0, stages: {} };
    current.total += 1;
    current.stages[stage] = (current.stages[stage] || 0) + 1;
    map.set(name, current);
  });
  return [...map.values()]
    .sort((a, b) => b.total - a.total)
    .map((row) => ({
      ...row,
      stages: stages.reduce<Record<string, number>>((acc, stage) => ({ ...acc, [stage]: row.stages[stage] || 0 }), {}),
    }));
}

function stageRows(rows: StoredEntity[], type: EntityType, mapping: StageMapping[]) {
  return groupCount(rows, (row) => stageOf(type, row.raw)).map((row) => ({
    ...row,
    kind: stageKind(type, row.name, mapping),
  }));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

export default App;
