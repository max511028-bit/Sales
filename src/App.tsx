import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Database,
  Download,
  Filter,
  GitBranch,
  History,
  Link2,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
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
import { db, clearDatabase, exportState } from "./db";
import { importCsv } from "./importer";
import { ensureDefaultStageMapping } from "./stageDefaults";
import { entitySummary, getFiltered, groupCount, kpis, lossReason, options, stageKind } from "./analytics";
import { FIELD, amountOf, stageOf, titleOf } from "./fields";
import type {
  ChangeLogEntry,
  DashboardFilters,
  EntityLink,
  EntityType,
  ImportRun,
  StageKind,
  StageMapping,
  StoredEntity,
} from "./types";

const COLORS = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#4b5563"];
const KIND_LABEL: Record<StageKind, string> = {
  work: "В работе",
  success: "Успех",
  loss: "Потеря",
  service: "Служебная",
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

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function App() {
  const [active, setActive] = useState("dashboard");
  const [leads, setLeads] = useState<StoredEntity[]>([]);
  const [deals, setDeals] = useState<StoredEntity[]>([]);
  const [links, setLinks] = useState<EntityLink[]>([]);
  const [imports, setImports] = useState<ImportRun[]>([]);
  const [changes, setChanges] = useState<ChangeLogEntry[]>([]);
  const [mapping, setMapping] = useState<StageMapping[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [selected, setSelected] = useState<StoredEntity | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const data = useMemo(() => ({ leads, deals, links, mapping }), [leads, deals, links, mapping]);
  const filtered = useMemo(() => getFiltered(data, filters), [data, filters]);
  const stats = useMemo(() => kpis(data, filters), [data, filters]);
  const filterOptions = useMemo(() => options(data), [data]);
  const linkMap = useMemo(() => new Map(links.map((link) => [link.dealId, link])), [links]);

  async function refresh() {
    await ensureDefaultStageMapping();
    const [nextLeads, nextDeals, nextLinks, nextImports, nextChanges, nextMapping] = await Promise.all([
      db.leads.toArray(),
      db.deals.toArray(),
      db.entityLinks.toArray(),
      db.imports.orderBy("createdAt").reverse().toArray(),
      db.changeLog.orderBy("changedAt").reverse().limit(200).toArray(),
      db.stageMapping.toArray(),
    ]);
    setLeads(nextLeads);
    setDeals(nextDeals);
    setLinks(nextLinks);
    setImports(nextImports);
    setChanges(nextChanges);
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
      setNotice(
        `Импортировано: ${result.importRun.rowCount}. Новых: ${result.importRun.inserted}, обновлено: ${result.importRun.updated}, без изменений: ${result.importRun.unchanged}.`,
      );
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось импортировать файл.");
    } finally {
      setBusy("");
    }
  }

  async function handleImportFromData(type: EntityType) {
    const path = type === "lead" ? "./data/leads.csv" : "./data/deals.csv";
    setBusy(`Загружаю ${type === "lead" ? "лиды" : "сделки"} из папки data...`);
    try {
      const response = await fetch(`${path}?t=${Date.now()}`);
      if (!response.ok) throw new Error(`Файл ${path} не найден.`);
      const blob = await response.blob();
      const file = new File([blob], type === "lead" ? "leads.csv" : "deals.csv", { type: "text/csv" });
      await handleImport(type, file);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить файл из папки data.");
      setBusy("");
    }
  }

  async function handleClear() {
    if (!window.confirm("Очистить локальную базу, импорты и журнал изменений?")) return;
    await clearDatabase();
    setSelected(null);
    await refresh();
  }

  async function handleExport() {
    const state = await exportState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crm-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const leadStages = groupCount(filtered.leads, (item) => stageOf("lead", item.raw));
  const dealStages = groupCount(filtered.deals, (item) => stageOf("deal", item.raw));
  const lossData = groupCount(
    filtered.deals.filter((deal) => stageKind("deal", stageOf("deal", deal.raw), mapping) === "loss"),
    (deal) => lossReason("deal", stageOf("deal", deal.raw), mapping),
  );
  const sourceData = groupCount(filtered.leads, (item) => item.raw[FIELD.source] || "Без источника").slice(0, 12);
  const linkData = groupCount(links, (link) => link.confidence);

  const searchable = [...filtered.leads, ...filtered.deals]
    .filter((entity) => {
      if (!query.trim()) return true;
      const haystack = `${entity.id} ${titleOf(entity.type, entity.raw)} ${Object.values(entity.raw).join(" ")}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    })
    .slice(0, 120);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BarChart3 size={26} />
          <div>
            <strong>CRM Dashboard</strong>
            <span>Bitrix CSV MVP</span>
          </div>
        </div>
        <nav>
          <button className={active === "dashboard" ? "active" : ""} onClick={() => setActive("dashboard")}>
            <BarChart3 size={18} /> Дашборд
          </button>
          <button className={active === "analytics" ? "active" : ""} onClick={() => setActive("analytics")}>
            <GitBranch size={18} /> Сквозная
          </button>
          <button className={active === "records" ? "active" : ""} onClick={() => setActive("records")}>
            <Search size={18} /> Записи
          </button>
          <button className={active === "changes" ? "active" : ""} onClick={() => setActive("changes")}>
            <History size={18} /> Изменения
          </button>
          <button className={active === "settings" ? "active" : ""} onClick={() => setActive("settings")}>
            <Settings size={18} /> Настройки
          </button>
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>{active === "dashboard" ? "Воронка продаж" : "CRM аналитика"}</h1>
            <p>Данные хранятся локально в браузере и обновляются повторной загрузкой CSV.</p>
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

        <Filters filters={filters} setFilters={setFilters} options={filterOptions} />

        {active === "dashboard" && (
          <>
            <section className="kpi-grid">
              <Kpi title="Лиды" value={stats.leads} />
              <Kpi title="Сделки" value={stats.deals} />
              <Kpi title="Уверенные связи" value={stats.strongLinks} hint={`${stats.linkRate}% сделок`} />
              <Kpi title="Конверсия лид -> сделка" value={`${stats.conversion}%`} />
              <Kpi title="Сумма сделок" value={formatMoney(stats.amount)} hint="руб." />
              <Kpi title="Потери" value={stats.lostDeals} />
            </section>
            <section className="grid two">
              <ChartPanel title="Лиды по стадиям">
                <HorizontalBars data={leadStages.slice(0, 12)} />
              </ChartPanel>
              <ChartPanel title="Сделки по стадиям">
                <HorizontalBars data={dealStages.slice(0, 12)} />
              </ChartPanel>
              <ChartPanel title="Причины потерь">
                <HorizontalBars data={lossData.slice(0, 12)} />
              </ChartPanel>
              <ChartPanel title="Источники лидов">
                <HorizontalBars data={sourceData} />
              </ChartPanel>
            </section>
          </>
        )}

        {active === "analytics" && (
          <section className="grid two">
            <ChartPanel title="Качество связки">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={linkData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100}>
                    {linkData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </ChartPanel>
            <div className="panel warning-panel">
              <AlertTriangle size={24} />
              <h2>Сквозная аналитика считает только уверенные связи</h2>
              <p>
                Сделки без надежного совпадения по телефону, email, DKT или roistat не включаются в основную конверсию,
                чтобы цифры не выглядели точнее исходных данных.
              </p>
              <div className="link-stats">
                {linkData.map((item) => (
                  <span key={item.name}>
                    {item.name}: <b>{item.value}</b>
                  </span>
                ))}
              </div>
            </div>
            <LinkedTable deals={filtered.deals} linkMap={linkMap} leads={leads} onSelect={setSelected} />
          </section>
        )}

        {active === "records" && (
          <section className="panel">
            <div className="panel-title">
              <h2>Лиды и сделки</h2>
              <div className="search">
                <Search size={16} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, название, телефон..." />
              </div>
            </div>
            <EntityTable rows={searchable} links={linkMap} onSelect={setSelected} />
          </section>
        )}

        {active === "changes" && <Changes imports={imports} changes={changes} />}

        {active === "settings" && (
          <SettingsView
            mapping={mapping}
            refresh={refresh}
            onClear={handleClear}
            onExport={handleExport}
            leads={leads}
            deals={deals}
          />
        )}
      </main>

      {selected && (
        <EntityDrawer entity={selected} links={links} leads={leads} deals={deals} changes={changes} onClose={() => setSelected(null)} />
      )}
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

function Filters({
  filters,
  setFilters,
  options,
}: {
  filters: DashboardFilters;
  setFilters: (filters: DashboardFilters) => void;
  options: ReturnType<typeof import("./analytics").options>;
}) {
  const set = (key: keyof DashboardFilters, value: string) => setFilters({ ...filters, [key]: value });
  return (
    <section className="filters">
      <Filter size={18} />
      <input type="date" value={filters.periodFrom} onChange={(e) => set("periodFrom", e.target.value)} />
      <input type="date" value={filters.periodTo} onChange={(e) => set("periodTo", e.target.value)} />
      <Select value={filters.responsible} onChange={(value) => set("responsible", value)} options={options.responsible} label="Ответственный" />
      <Select value={filters.source} onChange={(value) => set("source", value)} options={options.source} label="Источник" />
      <Select value={filters.project} onChange={(value) => set("project", value)} options={options.project} label="Проект" />
      <Select value={filters.stage} onChange={(value) => set("stage", value)} options={options.stage} label="Стадия" />
      <select value={filters.linkState} onChange={(e) => set("linkState", e.target.value)}>
        <option value="all">Все связи</option>
        <option value="strong">Уверенные</option>
        <option value="ambiguous">Неоднозначные</option>
        <option value="weak">Слабые</option>
        <option value="none">Без связи</option>
      </select>
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

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function HorizontalBars({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} layout="vertical" margin={{ left: 16, right: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} />
        <YAxis dataKey="name" type="category" width={190} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="value" fill="#2563eb" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EntityTable({
  rows,
  links,
  onSelect,
}: {
  rows: StoredEntity[];
  links: Map<string, EntityLink>;
  onSelect: (entity: StoredEntity) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Тип</th>
            <th>ID</th>
            <th>Название</th>
            <th>Стадия</th>
            <th>Ответственный</th>
            <th>Источник</th>
            <th>Сумма</th>
            <th>Связь</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const summary = entitySummary(row);
            const link = row.type === "deal" ? links.get(row.id) : undefined;
            return (
              <tr key={`${row.type}-${row.id}`} onClick={() => onSelect(row)}>
                <td>{row.type === "lead" ? "Лид" : "Сделка"}</td>
                <td>{row.id}</td>
                <td>{summary.title}</td>
                <td>{summary.stage}</td>
                <td>{summary.responsible}</td>
                <td>{summary.source}</td>
                <td>{formatMoney(summary.amount)}</td>
                <td>{link?.confidence || ""}</td>
              </tr>
            );
          })}
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
    <div className="panel wide">
      <h2>Связанные сделки</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Сделка</th>
              <th>Стадия</th>
              <th>Связь</th>
              <th>Лид-кандидат</th>
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
                  <td>
                    <Link2 size={14} /> {link?.confidence || "none"}
                  </td>
                  <td>{lead ? `${lead.id} · ${titleOf("lead", lead.raw)}` : link?.candidateLeadIds.join(", ")}</td>
                  <td>{link?.matchedFields.join(", ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Changes({ imports, changes }: { imports: ImportRun[]; changes: ChangeLogEntry[] }) {
  return (
    <section className="grid two">
      <div className="panel">
        <h2>Импорты</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип</th>
                <th>Файл</th>
                <th>Строк</th>
                <th>Новых</th>
                <th>Обновлено</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString("ru-RU")}</td>
                  <td>{item.entityType}</td>
                  <td>{item.fileName}</td>
                  <td>{item.rowCount}</td>
                  <td>{item.inserted}</td>
                  <td>{item.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h2>Последние изменения</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>ID</th>
                <th>Поле</th>
                <th>Было</th>
                <th>Стало</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.changedAt).toLocaleString("ru-RU")}</td>
                  <td>
                    {item.entityType} {item.entityId}
                  </td>
                  <td>{item.field}</td>
                  <td>{item.oldValue}</td>
                  <td>{item.newValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SettingsView({
  mapping,
  refresh,
  onClear,
  onExport,
  leads,
  deals,
}: {
  mapping: StageMapping[];
  refresh: () => Promise<void>;
  onClear: () => void;
  onExport: () => void;
  leads: StoredEntity[];
  deals: StoredEntity[];
}) {
  const stages = useMemo(() => {
    const current = new Map(mapping.map((item) => [`${item.entityType}:${item.stage}`, item]));
    const rows: StageMapping[] = [];
    [...leads, ...deals].forEach((entity) => {
      const stage = stageOf(entity.type, entity.raw);
      const key = `${entity.type}:${stage}`;
      rows.push(current.get(key) || { entityType: entity.type, stage, kind: stageKind(entity.type, stage, mapping) });
    });
    return [...new Map(rows.map((item) => [`${item.entityType}:${item.stage}`, item])).values()].sort((a, b) =>
      a.stage.localeCompare(b.stage, "ru"),
    );
  }, [mapping, leads, deals]);

  async function save(item: StageMapping, patch: Partial<StageMapping>) {
    const next = { ...item, ...patch };
    if (item.id) await db.stageMapping.put(next);
    else await db.stageMapping.add(next);
    await refresh();
  }

  return (
    <section className="grid two">
      <div className="panel">
        <h2>Данные</h2>
        <div className="actions">
          <button onClick={onExport}>
            <Download size={16} /> Экспорт JSON
          </button>
          <button className="danger" onClick={onClear}>
            <Trash2 size={16} /> Очистить базу
          </button>
        </div>
        <p className="muted">
          База находится в IndexedDB этого браузера. Для GitHub Pages это означает, что каждый пользователь хранит свою
          локальную копию данных.
        </p>
      </div>
      <div className="panel wide">
        <h2>Справочник стадий</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Тип</th>
                <th>Стадия</th>
                <th>Класс</th>
                <th>Причина потери</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((item) => (
                <tr key={`${item.entityType}-${item.stage}`}>
                  <td>{item.entityType === "lead" ? "Лид" : "Сделка"}</td>
                  <td>{item.stage}</td>
                  <td>
                    <select value={item.kind} onChange={(e) => save(item, { kind: e.target.value as StageKind })}>
                      {Object.entries(KIND_LABEL).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={item.lossReason || ""}
                      onChange={(e) => save(item, { lossReason: e.target.value })}
                      placeholder="Для стадий потери"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function EntityDrawer({
  entity,
  links,
  leads,
  deals,
  changes,
  onClose,
}: {
  entity: StoredEntity;
  links: EntityLink[];
  leads: StoredEntity[];
  deals: StoredEntity[];
  changes: ChangeLogEntry[];
  onClose: () => void;
}) {
  const summary = entitySummary(entity);
  const relatedLinks =
    entity.type === "deal" ? links.filter((link) => link.dealId === entity.id) : links.filter((link) => link.leadId === entity.id);
  const relatedEntities =
    entity.type === "deal"
      ? relatedLinks.flatMap((link) => leads.filter((lead) => lead.id === link.leadId || link.candidateLeadIds.includes(lead.id)))
      : relatedLinks.flatMap((link) => deals.filter((deal) => deal.id === link.dealId));
  const entityChanges = changes.filter((change) => change.entityType === entity.type && change.entityId === entity.id);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}>
          Закрыть
        </button>
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
              <b>
                {item.type === "lead" ? "Лид" : "Сделка"} #{item.id}
              </b>
              <span>{titleOf(item.type, item.raw)}</span>
            </div>
          ))
        ) : (
          <p className="muted">Связи не найдены.</p>
        )}
        <h3>Изменения</h3>
        {entityChanges.length ? (
          entityChanges.map((change) => (
            <div className="change-chip" key={change.id}>
              <b>{change.field}</b>
              <span>
                {change.oldValue || "пусто"} {"->"} {change.newValue || "пусто"}
              </span>
            </div>
          ))
        ) : (
          <p className="muted">Изменений в последних импортированных данных нет.</p>
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

export default App;
