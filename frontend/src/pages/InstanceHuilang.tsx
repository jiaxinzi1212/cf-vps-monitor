import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, Flex, Heading, SegmentedControl, Text } from '@radix-ui/themes';
import { Activity, ArrowLeft, Globe, Layers, Server } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Loading from '../components/Loading';
import DetailsGrid from '../components/DetailsGrid';
import { useAuth } from '../contexts/AuthContext';
import { useLiveData } from '../contexts/LiveDataContext';
import type { ClientInfo, LiveDataMap } from '../types';
import { publicFetch } from '../utils/api';
import { buildMonitorChartData, getMonitorChartRenderData, type MonitorChartPoint } from '../utils/monitorChartData';
import {
  formatMetricUptime,
  getNodeDisplayRecord,
  getNodeLastReportTime,
  getNodeStatus,
} from '../utils/nodeMetrics';
import {
  buildPingChartRows,
  fetchPingTaskSeries,
  getPingSeriesWithRecords,
  getPingTimeDomain,
  getPingYAxisDomain,
  type PingTaskSeries,
} from '../utils/pingChart';
import { normalizePublicClients } from '../utils/publicClients';
import {
  collectCursorHistory,
  normalizePublicMonitorRecords,
  type PublicMonitorRecord,
} from '../utils/publicHistory';
import './InstanceHuilang.css';

type TimeRange = '1h' | '12h' | '3d';
type DashboardMode = 'load' | 'ping';
type NetworkKind = 'ct' | 'cu' | 'cm' | 'bd' | 'other';

const RANGE_MS: Record<TimeRange, number> = {
  '1h': 3_600_000,
  '12h': 43_200_000,
  '3d': 259_200_000,
};

const RANGE_HOURS: Record<TimeRange, number> = {
  '1h': 1,
  '12h': 12,
  '3d': 72,
};

const RANGE_LIMIT: Record<TimeRange, number> = {
  '1h': 240,
  '12h': 720,
  '3d': 1000,
};

const RANGE_LABEL: Record<TimeRange, string> = {
  '1h': '1 小时',
  '12h': '12 小时',
  '3d': '3 天',
};

const NETWORK_META: Record<Exclude<NetworkKind, 'other'>, { label: string; color: string; aliases: RegExp[] }> = {
  ct: { label: '电信', color: '#ff6b9a', aliases: [/电信/i, /telecom/i, /(^|[^a-z])ct([^a-z]|$)/i] },
  cu: { label: '联通', color: '#d99a00', aliases: [/联通/i, /unicom/i, /(^|[^a-z])cu([^a-z]|$)/i] },
  cm: { label: '移动', color: '#12b8a6', aliases: [/移动/i, /mobile/i, /(^|[^a-z])cm([^a-z]|$)/i] },
  bd: { label: 'BD', color: '#6a8df5', aliases: [/bgp/i, /(^|[^a-z])bd([^a-z]|$)/i, /baidu/i, /百度/i] },
};

const FALLBACK_COLORS = ['#8b5cf6', '#22c55e', '#f97316', '#06b6d4'];

function historyQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  return query.toString();
}

function formatSpeed(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index >= 2 ? 1 : 0)} ${units[index]}`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const numberValue = Number(value);
  return `${numberValue.toFixed(numberValue < 10 ? 1 : 0)}%`;
}

function formatTimeTick(value: number, range: TimeRange) {
  const date = new Date(value);
  return range === '3d'
    ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit' })
    : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatTooltipTime(value: unknown) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function classifyTask(item: PingTaskSeries): NetworkKind {
  const text = `${item.task.label || ''} ${item.task.target || ''}`.trim();
  for (const kind of ['ct', 'cu', 'cm', 'bd'] as const) {
    if (NETWORK_META[kind].aliases.some((pattern) => pattern.test(text))) return kind;
  }
  return 'other';
}

function latestPing(item: PingTaskSeries) {
  if (!item.records.length) return null;
  const sorted = [...item.records].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const value = Number(sorted[sorted.length - 1]?.value);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function lossRate(item: PingTaskSeries) {
  let total = 0;
  let failed = 0;
  item.records.forEach((record) => {
    const value = Number(record.value);
    if (!Number.isFinite(value)) return;
    total += 1;
    if (value < 0) failed += 1;
  });
  return total > 0 ? (failed / total) * 100 : null;
}

function pingColor(value: number | null) {
  if (value === null) return '#ef476f';
  if (value < 80) return '#22c55e';
  if (value < 160) return '#16a3ff';
  if (value < 240) return '#f59e0b';
  return '#ef476f';
}

function LoadCard({
  title,
  value,
  secondary,
  color,
  children,
}: {
  title: string;
  value: string;
  secondary?: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="hl-load-card">
      <span className="hl-load-accent" style={{ background: color }} />
      <Flex justify="between" align="start" gap="3" className="hl-load-card-head">
        <Text weight="bold">{title}</Text>
        <div className="hl-load-card-value">
          <Text weight="medium">{value}</Text>
          {secondary ? <Text size="1" color="gray">{secondary}</Text> : null}
        </div>
      </Flex>
      <div className="hl-load-chart">{children}</div>
    </Card>
  );
}

function LoadDashboard({ data, range }: { data: MonitorChartPoint[]; range: TimeRange }) {
  const last = data.length ? data[data.length - 1] : null;
  const domain: [number | string, number | string] = data.length
    ? [data[0].time, data[data.length - 1].time]
    : ['dataMin', 'dataMax'];
  const margin = { top: 10, right: 12, bottom: 0, left: 0 };

  const commonXAxis = (
    <XAxis
      dataKey="time"
      type="number"
      domain={domain}
      tickFormatter={(value) => formatTimeTick(Number(value), range)}
      fontSize={11}
      minTickGap={28}
      tickLine={false}
      axisLine={false}
    />
  );

  return (
    <div className="hl-load-grid">
      <LoadCard title="CPU" value={formatPercent(last?.cpu)} secondary="使用率" color="#5b8cff">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={margin}>
            <defs><linearGradient id="hlCpu" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5b8cff" stopOpacity={0.24} /><stop offset="100%" stopColor="#5b8cff" stopOpacity={0.03} /></linearGradient></defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
            {commonXAxis}
            <YAxis width={42} domain={[0, 100]} tickFormatter={(value) => `${Math.round(Number(value))}%`} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`, 'CPU']} />
            <Area type="monotone" dataKey="cpu" stroke="#5b8cff" fill="url(#hlCpu)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </LoadCard>

      <LoadCard title="内存" value={formatPercent(last?.ram)} secondary="使用率" color="#a970ff">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={margin}>
            <defs><linearGradient id="hlRam" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a970ff" stopOpacity={0.24} /><stop offset="100%" stopColor="#a970ff" stopOpacity={0.03} /></linearGradient></defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
            {commonXAxis}
            <YAxis width={42} domain={[0, 100]} tickFormatter={(value) => `${Math.round(Number(value))}%`} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`, '内存']} />
            <Area type="monotone" dataKey="ram" stroke="#a970ff" fill="url(#hlRam)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </LoadCard>

      <LoadCard title="磁盘" value={formatPercent(last?.disk)} secondary="使用率" color="#e3a23b">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={margin}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
            {commonXAxis}
            <YAxis width={42} domain={[0, 100]} tickFormatter={(value) => `${Math.round(Number(value))}%`} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`, '磁盘']} />
            <Line type="monotone" dataKey="disk" stroke="#e3a23b" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </LoadCard>

      <LoadCard title="网络" value={`↓ ${formatSpeed(last?.net_in ?? 0)}`} secondary={`↑ ${formatSpeed(last?.net_out ?? 0)}`} color="#46c787">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={margin}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
            {commonXAxis}
            <YAxis width={58} tickFormatter={(value) => formatSpeed(Number(value))} fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(value: unknown, name: unknown) => [formatSpeed(Number(value)), String(name)]} />
            <Line type="monotone" dataKey="net_in" name="下载" stroke="#46c787" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="net_out" name="上传" stroke="#5b8cff" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </LoadCard>

      <LoadCard title="连接数" value={`TCP ${Math.round(last?.connections ?? 0)}`} secondary={`UDP ${Math.round(last?.connections_udp ?? 0)}`} color="#9b6cf6">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={margin}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
            {commonXAxis}
            <YAxis width={46} allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(value: unknown, name: unknown) => [Math.round(Number(value)), String(name)]} />
            <Line type="monotone" dataKey="connections" name="TCP" stroke="#9b6cf6" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="connections_udp" name="UDP" stroke="#5b8cff" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </LoadCard>

      <LoadCard title="进程" value={`${Math.round(last?.process_count ?? 0)}`} secondary="进程数" color="#e3a23b">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={margin}>
            <defs><linearGradient id="hlProcess" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e3a23b" stopOpacity={0.22} /><stop offset="100%" stopColor="#e3a23b" stopOpacity={0.03} /></linearGradient></defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
            {commonXAxis}
            <YAxis width={46} allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(value: unknown) => [Math.round(Number(value)), '进程数']} />
            <Area type="monotone" dataKey="process_count" stroke="#e3a23b" fill="url(#hlProcess)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </LoadCard>
    </div>
  );
}

function PingDashboard({
  series,
  range,
  loading,
  error,
  onRefresh,
}: {
  series: PingTaskSeries[];
  range: TimeRange;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [showLoss, setShowLoss] = useState(true);
  const [smooth, setSmooth] = useState(false);
  const [connectNulls, setConnectNulls] = useState(false);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());

  const ordered = useMemo(() => {
    const order: Record<NetworkKind, number> = { ct: 0, cu: 1, cm: 2, bd: 3, other: 4 };
    return [...getPingSeriesWithRecords(series)].sort((a, b) => order[classifyTask(a)] - order[classifyTask(b)]);
  }, [series]);
  const chartRows = useMemo(() => buildPingChartRows(ordered), [ordered]);
  const yDomain = useMemo(() => getPingYAxisDomain(ordered), [ordered]);
  const xDomain = useMemo(() => getPingTimeDomain(ordered, RANGE_HOURS[range]), [ordered, range]);

  const displaySeries = ordered.map((item, index) => {
    const kind = classifyTask(item);
    const meta = kind === 'other'
      ? { label: item.task.label || item.task.target || `Ping ${index + 1}`, color: FALLBACK_COLORS[index % FALLBACK_COLORS.length] }
      : NETWORK_META[kind];
    return { item, label: meta.label, color: meta.color };
  });

  const minInterval = ordered.length
    ? Math.min(...ordered.map((item) => item.task.intervalSec).filter((value) => Number.isFinite(value) && value > 0))
    : 0;

  const toggleSeries = (key: string) => {
    setHiddenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (hiddenKeys.size === displaySeries.length && displaySeries.length > 0) setHiddenKeys(new Set());
    else setHiddenKeys(new Set(displaySeries.map(({ item }) => item.task.key)));
  };

  if (loading) return <div className="hl-empty">正在加载 Ping 数据…</div>;
  if (error) return <div className="hl-empty hl-error">{error}</div>;
  if (!displaySeries.length || !chartRows.length) return <div className="hl-empty">暂无 Ping 记录，请先创建电信 / 联通 / 移动 Ping 任务。</div>;

  return (
    <div className="hl-ping-panel">
      <Flex justify="between" align="end" gap="3" wrap="wrap" className="hl-ping-head">
        <div>
          <Text size="5" weight="bold">Ping 图表</Text>
          <Text size="1" color="gray" className="hl-ping-caption">覆盖完整 {RANGE_LABEL[range]}{minInterval ? ` · 每 ${minInterval} 秒一个采样点` : ''}</Text>
        </div>
        <div className="hl-toolbar">
          <label className="hl-toggle"><input type="checkbox" checked={showLoss} onChange={(event) => setShowLoss(event.target.checked)} /><span>丢包色带</span></label>
          <label className="hl-toggle"><input type="checkbox" checked={smooth} onChange={(event) => setSmooth(event.target.checked)} /><span>削峰平滑</span></label>
          <label className="hl-toggle"><input type="checkbox" checked={connectNulls} onChange={(event) => setConnectNulls(event.target.checked)} /><span>断点连线</span></label>
          <button type="button" className="hl-tool-button" onClick={toggleAll}>{hiddenKeys.size === displaySeries.length ? '显示全部' : '隐藏全部'}</button>
          <button type="button" className="hl-tool-button" onClick={onRefresh}>↻ 刷新</button>
          <span className="hl-live-pill">{range === '1h' ? '实时' : '历史'}</span>
        </div>
      </Flex>

      <div className="hl-ping-chips">
        {displaySeries.map(({ item, label, color }) => {
          const latest = latestPing(item);
          const loss = lossRate(item);
          const hidden = hiddenKeys.has(item.task.key);
          return (
            <button
              key={item.task.key}
              type="button"
              className={`hl-ping-chip${hidden ? ' is-hidden' : ''}`}
              style={{ borderColor: color }}
              onClick={() => toggleSeries(item.task.key)}
              title={`${item.task.type} ${item.task.target}`}
            >
              <span className="hl-ping-dot" style={{ background: color }} />
              <strong>{label}</strong>
              <span style={{ color: pingColor(latest), fontWeight: 700 }}>{latest === null ? '超时' : `${latest.toFixed(1)} ms`}</span>
              <span className="hl-loss-rate">{loss === null ? '—' : `${loss.toFixed(1)}%`}</span>
            </button>
          );
        })}
      </div>

      {showLoss ? (
        <div className="hl-loss-strips">
          {displaySeries.map(({ item, label }) => (
            <div className="hl-loss-row" key={item.task.key}>
              <span className="hl-loss-label">{label}</span>
              <div className="hl-loss-band">
                {item.records.slice(-96).map((record, index) => {
                  const value = Number(record.value);
                  const ok = Number.isFinite(value) && value >= 0;
                  return (
                    <span
                      key={`${record.time}-${index}`}
                      className={`hl-loss-cell ${ok ? 'is-ok' : 'is-loss'}`}
                      title={`${new Date(record.time).toLocaleString('zh-CN')} · ${ok ? `${Math.round(value)} ms` : '丢包/超时'}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="hl-ping-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartRows} margin={{ top: 12, right: 18, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.18} />
            <XAxis dataKey="time" type="number" domain={xDomain} tickFormatter={(value) => formatTimeTick(Number(value), range)} fontSize={11} minTickGap={34} tickLine={false} axisLine={false} />
            <YAxis width={58} domain={yDomain} allowDecimals={false} tickFormatter={(value) => `${Math.round(Number(value))} ms`} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(value: unknown, name: unknown) => [`${Math.round(Number(value))} ms`, String(name)]} />
            {displaySeries.map(({ item, label, color }) => (
              <Line
                key={item.task.key}
                type={smooth ? 'monotone' : 'linear'}
                dataKey={item.task.key}
                name={label}
                stroke={color}
                strokeWidth={2.1}
                dot={false}
                connectNulls={connectNulls}
                hide={hiddenKeys.has(item.task.key)}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function InstanceHuilang() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const { authLoading, isAuthenticated } = useAuth();
  const { liveData, snapshotReady } = useLiveData();
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [records, setRecords] = useState<PublicMonitorRecord[]>([]);
  const [pingSeries, setPingSeries] = useState<PingTaskSeries[]>([]);
  const [loadingClient, setLoadingClient] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [pingLoading, setPingLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [mode, setMode] = useState<DashboardMode>('load');
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [rangeEnd, setRangeEnd] = useState(() => Date.now());
  const [pingRefresh, setPingRefresh] = useState(0);

  const liveView: LiveDataMap = useMemo(() => ({
    online: liveData?.online || [],
    data: liveData?.data || {},
    clients: liveData?.clients || [],
    last_known: liveData?.last_known || {},
    statusReady: snapshotReady,
  }), [liveData, snapshotReady]);

  const liveRecord = uuid ? getNodeDisplayRecord(uuid, liveView) : undefined;
  const nodeStatus = uuid ? getNodeStatus(uuid, liveView) : 'unknown';

  const loadClient = useCallback(async (signal?: AbortSignal) => {
    if (!uuid || authLoading) return;
    setLoadingClient(true);
    try {
      setError(null);
      const payload = await publicFetch(`/nodes${isAuthenticated ? '?include_hidden=1' : ''}`, { signal });
      if (signal?.aborted) return;
      const clients = normalizePublicClients(payload, { includeHidden: isAuthenticated });
      const found = clients.find((item) => item.uuid === uuid) || null;
      setClient(found);
      if (!found) setError('服务器不存在');
    } catch {
      if (!signal?.aborted) setError('加载服务器信息失败');
    } finally {
      if (!signal?.aborted) setLoadingClient(false);
    }
  }, [uuid, authLoading, isAuthenticated]);

  useEffect(() => {
    const controller = new AbortController();
    void loadClient(controller.signal);
    return () => controller.abort();
  }, [loadClient]);

  useEffect(() => {
    if (!uuid || authLoading) return;
    const controller = new AbortController();
    const endTs = Date.now();
    const startTs = endTs - RANGE_MS[timeRange];
    const start = new Date(startTs).toISOString();
    const end = new Date(endTs).toISOString();
    setRangeEnd(endTs);
    setLoadingRecords(true);
    setRecords([]);

    collectCursorHistory(
      (cursor) => publicFetch(`/records/load?${historyQuery({ uuid, start, end, cursor, limit: Math.min(RANGE_LIMIT[timeRange], 500), include_hidden: isAuthenticated ? 1 : undefined })}`, { signal: controller.signal }),
      { cursor: end, start, end, normalize: normalizePublicMonitorRecords, signal: controller.signal },
    )
      .then((data) => { if (!controller.signal.aborted) setRecords(data); })
      .catch(() => { if (!controller.signal.aborted) setError('加载监控历史失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoadingRecords(false); });

    return () => controller.abort();
  }, [uuid, authLoading, isAuthenticated, timeRange]);

  useEffect(() => {
    if (!uuid || authLoading) return;
    const controller = new AbortController();
    setPingLoading(true);
    setPingError(null);
    fetchPingTaskSeries(uuid, {
      limit: 360,
      maxTasks: 8,
      rangeHours: RANGE_HOURS[timeRange],
      cursor: new Date().toISOString(),
      includeHidden: isAuthenticated,
      signal: controller.signal,
    })
      .then((data) => { if (!controller.signal.aborted) setPingSeries(data); })
      .catch(() => { if (!controller.signal.aborted) setPingError('加载 Ping 数据失败'); })
      .finally(() => { if (!controller.signal.aborted) setPingLoading(false); });
    return () => controller.abort();
  }, [uuid, authLoading, isAuthenticated, timeRange, pingRefresh]);

  if (loadingClient || (loadingRecords && records.length === 0)) return <Loading />;
  if (error || !client) return <Text color="red" align="center" style={{ display: 'block', padding: 40 }}>{error || '未找到服务器'}</Text>;

  const chartData = buildMonitorChartData(records);
  const chartRenderData = getMonitorChartRenderData(chartData, RANGE_MS[timeRange], rangeEnd);
  const latestHistory = records.length ? records[records.length - 1] : undefined;
  const latest = liveRecord || latestHistory;
  const lastReport = liveRecord && uuid ? getNodeLastReportTime(uuid, liveView) : latestHistory ? Date.parse(latestHistory.time) : undefined;

  return (
    <div className="hl-instance-page">
      <Flex justify="between" align="center" mb="4">
        <Button variant="ghost" onClick={() => navigate('/')}><ArrowLeft size={16} /> 返回</Button>
      </Flex>

      <Card className="hl-summary-card">
        <Flex align="center" gap="3" wrap="wrap" className="hl-summary-title">
          <Server size={24} color="var(--accent-9)" />
          <Heading size="5">{client.name}</Heading>
          {client.region ? <Badge color="gray"><Globe size={12} /> {client.region}</Badge> : null}
          {client.group ? <Badge color="purple"><Layers size={12} /> {client.group}</Badge> : null}
          <Badge color={nodeStatus === 'online' ? 'green' : nodeStatus === 'offline' ? 'red' : 'gray'} variant="solid">
            <Activity size={12} /> {nodeStatus === 'online' ? `在线 · 已运行 ${formatMetricUptime(latest?.uptime)}` : nodeStatus === 'offline' ? '离线' : '确认中'}
          </Badge>
          {nodeStatus === 'offline' && lastReport ? <Text size="1" color="gray">最后上报 {new Date(lastReport).toLocaleString('zh-CN')}</Text> : null}
        </Flex>
        <DetailsGrid client={client} live={latest || undefined} compact remark={client.public_remark} />
      </Card>

      <div className="hl-controls">
        <SegmentedControl.Root value={mode} onValueChange={(value) => setMode(value as DashboardMode)} size="2">
          <SegmentedControl.Item value="load">负载</SegmentedControl.Item>
          <SegmentedControl.Item value="ping">Ping</SegmentedControl.Item>
        </SegmentedControl.Root>
        <SegmentedControl.Root value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)} size="2">
          <SegmentedControl.Item value="1h">1 小时</SegmentedControl.Item>
          <SegmentedControl.Item value="12h">12 小时</SegmentedControl.Item>
          <SegmentedControl.Item value="3d">3 天</SegmentedControl.Item>
        </SegmentedControl.Root>
      </div>

      <Card className="hl-dashboard-card">
        {mode === 'load' ? (
          <>
            <Flex justify="between" align="center" mb="3"><Text size="5" weight="bold">负载图表</Text><Text size="1" color="gray">最近 {RANGE_LABEL[timeRange]}</Text></Flex>
            <LoadDashboard data={chartRenderData} range={timeRange} />
          </>
        ) : (
          <PingDashboard series={pingSeries} range={timeRange} loading={pingLoading} error={pingError} onRefresh={() => setPingRefresh((value) => value + 1)} />
        )}
      </Card>
    </div>
  );
}
