import { useMemo, useState, type ReactNode } from 'react';
import { Card, Flex, SegmentedControl, Text } from '@radix-ui/themes';
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
import type { MonitorChartPoint } from '../utils/monitorChartData';
import {
  buildPingChartRows,
  getPingSeriesWithRecords,
  getPingTimeDomain,
  getPingYAxisDomain,
  type PingChartRow,
  type PingTaskSeries,
} from '../utils/pingChart';
import './InstanceMetricsDashboard.css';

export type InstanceDashboardRange = '1h' | '12h' | '3d';
type Mode = 'load' | 'ping';
type NetworkKind = 'ct' | 'cu' | 'cm' | 'bd' | 'other';

type Props = {
  timeRange: InstanceDashboardRange;
  onTimeRangeChange: (value: string) => void;
  chartData: MonitorChartPoint[];
  pingSeries: PingTaskSeries[];
  pingLoading: boolean;
  pingError: string | null;
  onRefreshPing: () => void;
};

const rangeHours: Record<InstanceDashboardRange, number> = {
  '1h': 1,
  '12h': 12,
  '3d': 72,
};

const rangeLabel: Record<InstanceDashboardRange, string> = {
  '1h': '1 小时',
  '12h': '12 小时',
  '3d': '3 天',
};

const networkDefinitions = {
  ct: {
    label: '电信',
    color: '#ff6b9a',
    aliases: [/电信/i, /telecom/i, /(^|[^a-z])ct([^a-z]|$)/i],
  },
  cu: {
    label: '联通',
    color: '#d99a00',
    aliases: [/联通/i, /unicom/i, /(^|[^a-z])cu([^a-z]|$)/i],
  },
  cm: {
    label: '移动',
    color: '#12b8a6',
    aliases: [/移动/i, /mobile/i, /(^|[^a-z])cm([^a-z]|$)/i],
  },
  bd: {
    label: 'BD',
    color: '#6a8df5',
    aliases: [/(^|[^a-z])bd([^a-z]|$)/i, /bgp/i, /baidu/i, /百度/i],
  },
} as const;

const fallbackColors = ['#8b5cf6', '#22c55e', '#f97316', '#06b6d4'];

function formatSpeed(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, power);
  return `${value.toFixed(power >= 2 ? 1 : 0)} ${units[power]}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const numberValue = Number(value);
  return `${numberValue.toFixed(numberValue < 10 ? 1 : 0)}%`;
}

function formatChartTime(value: number, range: InstanceDashboardRange): string {
  const date = new Date(value);
  return range === '3d'
    ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit' })
    : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatTooltipTime(value: unknown): string {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function MetricCard({
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
  children: ReactNode;
}) {
  return (
    <Card className="hl-metric-card">
      <div className="hl-metric-accent" style={{ background: color }} />
      <Flex justify="between" align="start" gap="3" className="hl-metric-header">
        <Text weight="bold" className="hl-metric-title">{title}</Text>
        <div className="hl-metric-reading">
          <Text size="2" weight="medium">{value}</Text>
          {secondary ? <Text size="1" color="gray">{secondary}</Text> : null}
        </div>
      </Flex>
      <div className="hl-metric-chart">{children}</div>
    </Card>
  );
}

function LoadPanel({ data, range }: { data: MonitorChartPoint[]; range: InstanceDashboardRange }) {
  const latest = data.length ? data[data.length - 1] : null;
  const domain: [number | string, number | string] = data.length
    ? [data[0].time, data[data.length - 1].time]
    : ['dataMin', 'dataMax'];
  const margin = { top: 10, right: 10, bottom: 0, left: 0 };

  const axis = (
    <XAxis
      dataKey="time"
      type="number"
      domain={domain}
      tickFormatter={(value) => formatChartTime(Number(value), range)}
      fontSize={10}
      minTickGap={28}
      tickLine={false}
      axisLine={false}
    />
  );
  const grid = <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />;

  return (
    <div className="hl-load-grid">
      <MetricCard title="CPU" value={formatPercent(latest?.cpu)} secondary="使用率" color="#5B8CFF">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={margin}>
            <defs>
              <linearGradient id="hlCpuFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5B8CFF" stopOpacity={0.24} />
                <stop offset="100%" stopColor="#5B8CFF" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            {grid}{axis}
            <YAxis width={42} domain={[0, 100]} tickFormatter={(v) => `${Math.round(Number(v))}%`} fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(v: number) => [`${Number(v).toFixed(1)}%`, 'CPU']} />
            <Area type="monotone" dataKey="cpu" stroke="#5B8CFF" fill="url(#hlCpuFill)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </MetricCard>

      <MetricCard title="内存" value={formatPercent(latest?.ram)} secondary="使用率" color="#A970FF">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={margin}>
            <defs>
              <linearGradient id="hlRamFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#A970FF" stopOpacity={0.24} />
                <stop offset="100%" stopColor="#A970FF" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            {grid}{axis}
            <YAxis width={42} domain={[0, 100]} tickFormatter={(v) => `${Math.round(Number(v))}%`} fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(v: number) => [`${Number(v).toFixed(1)}%`, '内存']} />
            <Area type="monotone" dataKey="ram" stroke="#A970FF" fill="url(#hlRamFill)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </MetricCard>

      <MetricCard title="磁盘" value={formatPercent(latest?.disk)} secondary="使用率" color="#E3A23B">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={margin}>
            {grid}{axis}
            <YAxis width={42} domain={[0, 100]} tickFormatter={(v) => `${Math.round(Number(v))}%`} fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(v: number) => [`${Number(v).toFixed(1)}%`, '磁盘']} />
            <Line type="monotone" dataKey="disk" stroke="#E3A23B" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </MetricCard>

      <MetricCard
        title="网络"
        value={`↓ ${formatSpeed(latest?.net_in ?? 0)}`}
        secondary={`↑ ${formatSpeed(latest?.net_out ?? 0)}`}
        color="#46C787"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={margin}>
            {grid}{axis}
            <YAxis width={56} tickFormatter={(v) => formatSpeed(Number(v))} fontSize={9} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(v: number, name) => [formatSpeed(Number(v)), name]} />
            <Line type="monotone" dataKey="net_in" name="下载" stroke="#46C787" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="net_out" name="上传" stroke="#5B8CFF" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </MetricCard>

      <MetricCard
        title="连接数"
        value={`TCP ${Math.round(latest?.connections ?? 0)}`}
        secondary={`UDP ${Math.round(latest?.connections_udp ?? 0)}`}
        color="#9B6CF6"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={margin}>
            {grid}{axis}
            <YAxis width={44} allowDecimals={false} fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(v: number, name) => [Math.round(Number(v)), name]} />
            <Line type="monotone" dataKey="connections" name="TCP" stroke="#9B6CF6" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="connections_udp" name="UDP" stroke="#5B8CFF" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </MetricCard>

      <MetricCard title="进程" value={`${Math.round(latest?.process_count ?? 0)}`} secondary="进程数" color="#E3A23B">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={margin}>
            <defs>
              <linearGradient id="hlProcessFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#E3A23B" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#E3A23B" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            {grid}{axis}
            <YAxis width={44} allowDecimals={false} fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(v: number) => [Math.round(Number(v)), '进程数']} />
            <Area type="monotone" dataKey="process_count" stroke="#E3A23B" fill="url(#hlProcessFill)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </MetricCard>
    </div>
  );
}

function taskText(item: PingTaskSeries): string {
  return `${item.task.label || ''} ${item.task.target || ''}`.trim();
}

function classifyTask(item: PingTaskSeries): NetworkKind {
  const text = taskText(item);
  for (const key of ['ct', 'cu', 'cm', 'bd'] as const) {
    if (networkDefinitions[key].aliases.some((pattern) => pattern.test(text))) return key;
  }
  return 'other';
}

function latestPing(item: PingTaskSeries): number | null {
  for (let index = item.records.length - 1; index >= 0; index -= 1) {
    const value = Number(item.records[index]?.value);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function lossRate(item: PingTaskSeries): number | null {
  let total = 0;
  let failed = 0;
  for (const record of item.records) {
    const value = Number(record.value);
    if (!Number.isFinite(value)) continue;
    total += 1;
    if (value < 0) failed += 1;
  }
  return total ? (failed / total) * 100 : null;
}

function latencyColor(value: number | null): string {
  if (value === null) return '#ef476f';
  if (value < 80) return '#22c55e';
  if (value < 160) return '#16a3ff';
  if (value < 240) return '#f59e0b';
  return '#ef476f';
}

function smoothRows(rows: PingChartRow[], series: PingTaskSeries[]): PingChartRow[] {
  if (rows.length < 3) return rows;
  const keys = series.map((item) => item.task.key);
  return rows.map((row, index) => {
    const next: PingChartRow = { ...row };
    for (const key of keys) {
      const values = [index - 1, index, index + 1]
        .map((position) => Number(rows[position]?.[key]))
        .filter((value) => Number.isFinite(value) && value >= 0);
      if (values.length > 0) next[key] = values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    return next;
  });
}

function PingPanel({
  series,
  range,
  loading,
  error,
  onRefresh,
}: {
  series: PingTaskSeries[];
  range: InstanceDashboardRange;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [connectNulls, setConnectNulls] = useState(false);
  const [smooth, setSmooth] = useState(false);
  const [showLoss, setShowLoss] = useState(true);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());

  const ordered = useMemo(() => {
    const order: Record<NetworkKind, number> = { ct: 0, cu: 1, cm: 2, bd: 3, other: 4 };
    return [...getPingSeriesWithRecords(series)].sort((a, b) => order[classifyTask(a)] - order[classifyTask(b)]);
  }, [series]);

  const rawRows = useMemo(() => buildPingChartRows(ordered), [ordered]);
  const chartRows = useMemo(() => smooth ? smoothRows(rawRows, ordered) : rawRows, [rawRows, ordered, smooth]);
  const yDomain = useMemo(() => getPingYAxisDomain(ordered), [ordered]);
  const xDomain = useMemo(() => getPingTimeDomain(ordered, rangeHours[range]), [ordered, range]);

  const displaySeries = ordered.map((item, index) => {
    const kind = classifyTask(item);
    const fallback = { label: item.task.label || item.task.target || `Ping ${index + 1}`, color: fallbackColors[index % fallbackColors.length] };
    const meta = kind === 'other' ? fallback : networkDefinitions[kind];
    return { item, label: meta.label, color: meta.color };
  });

  const allHidden = displaySeries.length > 0 && hiddenKeys.size === displaySeries.length;
  const toggleAll = () => {
    setHiddenKeys(allHidden ? new Set() : new Set(displaySeries.map(({ item }) => item.task.key)));
  };
  const toggleOne = (key: string) => {
    setHiddenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading) return <div className="hl-empty">正在加载 Ping 数据…</div>;
  if (error) return <div className="hl-empty hl-empty-error">{error}</div>;
  if (!ordered.length || !chartRows.length) return <div className="hl-empty">暂无 Ping 记录，请先创建电信 / 联通 / 移动 Ping 任务。</div>;

  const intervals = ordered.map((item) => Number(item.task.intervalSec)).filter((value) => Number.isFinite(value) && value > 0);
  const sampleInterval = intervals.length ? Math.min(...intervals) : 0;

  return (
    <>
      <Flex justify="between" align="end" gap="3" wrap="wrap" mb="3">
        <div>
          <Text size="5" weight="bold">Ping 图表</Text>
          <Text size="1" color="gray" className="hl-ping-caption">
            覆盖 {rangeLabel[range]}{sampleInterval ? ` · 每 ${sampleInterval} 秒一个采样点` : ''}
          </Text>
        </div>
        <div className="hl-toolbar">
          <label><input type="checkbox" checked={showLoss} onChange={(event) => setShowLoss(event.target.checked)} /> 丢包色带</label>
          <label><input type="checkbox" checked={smooth} onChange={(event) => setSmooth(event.target.checked)} /> 削峰平滑</label>
          <label><input type="checkbox" checked={connectNulls} onChange={(event) => setConnectNulls(event.target.checked)} /> 断点连线</label>
          <button type="button" onClick={toggleAll}>{allHidden ? '显示全部' : '隐藏全部'}</button>
          <button type="button" onClick={onRefresh}>↻ 刷新</button>
          <span className="hl-realtime-pill">{range === '1h' ? '实时' : '历史'}</span>
        </div>
      </Flex>

      <div className="hl-ping-chips">
        {displaySeries.map(({ item, label, color }) => {
          const ping = latestPing(item);
          const loss = lossRate(item);
          const hidden = hiddenKeys.has(item.task.key);
          return (
            <button
              type="button"
              key={item.task.key}
              className={`hl-ping-chip${hidden ? ' is-hidden' : ''}`}
              style={{ borderColor: color }}
              onClick={() => toggleOne(item.task.key)}
              title={`${item.task.type} ${item.task.target}`}
            >
              <span className="hl-ping-dot" style={{ background: color }} />
              <strong>{label}</strong>
              <b style={{ color: latencyColor(ping) }}>{ping === null ? '超时' : `${ping.toFixed(1)} ms`}</b>
              <em>{loss === null ? '—' : `${loss.toFixed(1)}%`}</em>
            </button>
          );
        })}
      </div>

      {showLoss ? (
        <div className="hl-loss-list">
          {displaySeries.map(({ item, label }) => (
            <div className="hl-loss-row" key={item.task.key}>
              <span>{label}</span>
              <div>
                {item.records.slice(-96).map((record, index) => {
                  const value = Number(record.value);
                  const ok = Number.isFinite(value) && value >= 0;
                  return (
                    <i
                      key={`${record.time}-${index}`}
                      className={ok ? 'ok' : 'bad'}
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
          <LineChart data={chartRows} margin={{ top: 10, right: 14, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.18} />
            <XAxis
              dataKey="time"
              type="number"
              domain={xDomain}
              tickFormatter={(value) => formatChartTime(Number(value), range)}
              fontSize={10}
              minTickGap={34}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              width={58}
              domain={yDomain}
              allowDecimals={false}
              tickFormatter={(value) => `${Math.round(Number(value))} ms`}
              fontSize={10}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip labelFormatter={formatTooltipTime} formatter={(value: number, name) => [`${Math.round(Number(value))} ms`, name]} />
            {displaySeries.map(({ item, label, color }) => (
              <Line
                key={item.task.key}
                type={smooth ? 'monotone' : 'linear'}
                dataKey={item.task.key}
                name={label}
                stroke={color}
                strokeWidth={2.1}
                strokeOpacity={hiddenKeys.has(item.task.key) ? 0 : 1}
                dot={false}
                connectNulls={connectNulls}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export default function InstanceMetricsDashboard(props: Props) {
  const [mode, setMode] = useState<Mode>('load');

  return (
    <div className="hl-dashboard">
      <div className="hl-switch-row">
        <SegmentedControl.Root value={mode} onValueChange={(value) => setMode(value as Mode)} size="2">
          <SegmentedControl.Item value="load">负载</SegmentedControl.Item>
          <SegmentedControl.Item value="ping">Ping</SegmentedControl.Item>
        </SegmentedControl.Root>
        <SegmentedControl.Root value={props.timeRange} onValueChange={props.onTimeRangeChange} size="2">
          <SegmentedControl.Item value="1h">1 小时</SegmentedControl.Item>
          <SegmentedControl.Item value="12h">12 小时</SegmentedControl.Item>
          <SegmentedControl.Item value="3d">3 天</SegmentedControl.Item>
        </SegmentedControl.Root>
      </div>

      <Card className="hl-dashboard-card">
        {mode === 'load' ? (
          <>
            <Flex justify="between" align="center" mb="3" gap="3" wrap="wrap">
              <Text size="5" weight="bold">负载图表</Text>
              <Text size="1" color="gray">最近 {rangeLabel[props.timeRange]}</Text>
            </Flex>
            <LoadPanel data={props.chartData} range={props.timeRange} />
          </>
        ) : (
          <PingPanel
            series={props.pingSeries}
            range={props.timeRange}
            loading={props.pingLoading}
            error={props.pingError}
            onRefresh={props.onRefreshPing}
          />
        )}
      </Card>
    </div>
  );
}
