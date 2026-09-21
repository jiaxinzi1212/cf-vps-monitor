import { useMemo, useState } from 'react';
import { Card, Flex, SegmentedControl, Text } from '@radix-ui/themes';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { MonitorChartPoint } from '../utils/monitorChartData';
import {
  buildPingChartRows, getPingSeriesWithRecords, getPingTimeDomain,
  getPingYAxisDomain, type PingTaskSeries,
} from '../utils/pingChart';

export type InstanceDashboardRange = '1h' | '12h' | '3d';
type Mode = 'load' | 'ping';

type Props = {
  timeRange: InstanceDashboardRange;
  onTimeRangeChange: (value: string) => void;
  chartData: MonitorChartPoint[];
  pingSeries: PingTaskSeries[];
  pingLoading: boolean;
  pingError: string | null;
  onRefreshPing: () => void;
};

const rangeHours: Record<InstanceDashboardRange, number> = { '1h': 1, '12h': 12, '3d': 72 };
const rangeLabel: Record<InstanceDashboardRange, string> = { '1h': '1 小时', '12h': '12 小时', '3d': '3 天' };

const netDefs = [
  { key: 'ct', label: '电信', color: '#ff6b9a', re: /(电信|telecom|\bct\b)/i },
  { key: 'cu', label: '联通', color: '#d99a00', re: /(联通|unicom|\bcu\b)/i },
  { key: 'cm', label: '移动', color: '#12b8a6', re: /(移动|mobile|\bcm\b)/i },
  { key: 'bd', label: 'BD', color: '#6a8df5', re: /(\bbd\b|bgp|baidu|百度)/i },
] as const;

function formatSpeed(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

function fmtTime(value: number, range: InstanceDashboardRange) {
  const date = new Date(value);
  return range === '3d'
    ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit' })
    : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function metricCard(title: string, value: string, color: string, body: React.ReactNode) {
  return (
    <Card className="hl-metric-card">
      <div className="hl-metric-accent" style={{ background: color }} />
      <Flex justify="between" mb="2"><Text weight="bold">{title}</Text><Text size="2">{value}</Text></Flex>
      <div className="hl-metric-chart">{body}</div>
    </Card>
  );
}

function LoadPanel({ data, range }: { data: MonitorChartPoint[]; range: InstanceDashboardRange }) {
  const latest = data[data.length - 1];
  const x = <XAxis dataKey="time" type="number" tickFormatter={(v) => fmtTime(Number(v), range)} fontSize={10} minTickGap={28} tickLine={false} axisLine={false} />;
  const grid = <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />;
  const margin = { top: 8, right: 8, bottom: 0, left: 0 };
  return <div className="hl-load-grid">
    {metricCard('CPU', `${(latest?.cpu ?? 0).toFixed(1)}%`, '#5B8CFF', <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={margin}>{grid}{x}<YAxis width={38} domain={[0,100]} tickFormatter={(v)=>`${v}%`} fontSize={10}/><Tooltip/><Area dataKey="cpu" stroke="#5B8CFF" fill="#5B8CFF" fillOpacity={0.12} dot={false} isAnimationActive={false}/></AreaChart></ResponsiveContainer>)}
    {metricCard('内存', `${(latest?.ram ?? 0).toFixed(1)}%`, '#A970FF', <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={margin}>{grid}{x}<YAxis width={38} domain={[0,100]} tickFormatter={(v)=>`${v}%`} fontSize={10}/><Tooltip/><Area dataKey="ram" stroke="#A970FF" fill="#A970FF" fillOpacity={0.12} dot={false} isAnimationActive={false}/></AreaChart></ResponsiveContainer>)}
    {metricCard('磁盘', latest?.disk == null ? '—' : `${latest.disk.toFixed(1)}%`, '#E3A23B', <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={margin}>{grid}{x}<YAxis width={38} domain={[0,100]} tickFormatter={(v)=>`${v}%`} fontSize={10}/><Tooltip/><Line dataKey="disk" stroke="#E3A23B" dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer>)}
    {metricCard('网络', `↓ ${formatSpeed(latest?.net_in ?? 0)} · ↑ ${formatSpeed(latest?.net_out ?? 0)}`, '#46C787', <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={margin}>{grid}{x}<YAxis width={52} tickFormatter={(v)=>formatSpeed(Number(v))} fontSize={9}/><Tooltip/><Line dataKey="net_in" name="下载" stroke="#46C787" dot={false} isAnimationActive={false}/><Line dataKey="net_out" name="上传" stroke="#5B8CFF" dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer>)}
    {metricCard('连接数', `TCP ${Math.round(latest?.connections ?? 0)} / UDP ${Math.round(latest?.connections_udp ?? 0)}`, '#9B6CF6', <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={margin}>{grid}{x}<YAxis width={38} fontSize={10}/><Tooltip/><Line dataKey="connections" name="TCP" stroke="#9B6CF6" dot={false} isAnimationActive={false}/><Line dataKey="connections_udp" name="UDP" stroke="#5B8CFF" dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer>)}
    {metricCard('进程', `${Math.round(latest?.process_count ?? 0)}`, '#E3A23B', <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={margin}>{grid}{x}<YAxis width={38} fontSize={10}/><Tooltip/><Area dataKey="process_count" stroke="#E3A23B" fill="#E3A23B" fillOpacity={0.12} dot={false} isAnimationActive={false}/></AreaChart></ResponsiveContainer>)}
  </div>;
}

function PingPanel({ series, range, loading, error, onRefresh }: { series: PingTaskSeries[]; range: InstanceDashboardRange; loading: boolean; error: string | null; onRefresh: () => void }) {
  const [connectNulls, setConnectNulls] = useState(false);
  const [smooth, setSmooth] = useState(false);
  const [showLoss, setShowLoss] = useState(true);
  const ordered = useMemo(() => {
    const src = getPingSeriesWithRecords(series);
    return [...src].sort((a,b) => {
      const find = (x: PingTaskSeries) => { const t = `${x.task.label} ${x.task.target}`; const i = netDefs.findIndex(d => d.re.test(t)); return i < 0 ? 99 : i; };
      return find(a)-find(b);
    });
  }, [series]);
  const rows = useMemo(() => buildPingChartRows(ordered), [ordered]);
  const yDomain = useMemo(() => getPingYAxisDomain(ordered), [ordered]);
  const xDomain = useMemo(() => getPingTimeDomain(ordered, rangeHours[range]), [ordered, range]);
  if (loading) return <div className="hl-empty">正在加载 Ping 数据…</div>;
  if (error) return <div className="hl-empty">{error}</div>;
  if (!ordered.length) return <div className="hl-empty">暂无 Ping 记录</div>;
  return <>
    <Flex justify="between" align="end" gap="3" wrap="wrap" mb="3">
      <div><Text size="5" weight="bold">Ping 图表</Text><Text size="1" color="gray" style={{display:'block'}}>覆盖 {rangeLabel[range]}</Text></div>
      <div className="hl-toolbar">
        <label><input type="checkbox" checked={showLoss} onChange={e=>setShowLoss(e.target.checked)}/> 丢包色带</label>
        <label><input type="checkbox" checked={smooth} onChange={e=>setSmooth(e.target.checked)}/> 削峰平滑</label>
        <label><input type="checkbox" checked={connectNulls} onChange={e=>setConnectNulls(e.target.checked)}/> 断点连线</label>
        <button type="button" onClick={onRefresh}>↻ 刷新</button>
      </div>
    </Flex>
    <div className="hl-ping-chips">{ordered.map((item,index)=>{
      const text=`${item.task.label} ${item.task.target}`; const def=netDefs.find(d=>d.re.test(text)); const color=def?.color ?? item.task.color; const valid=item.records.filter(r=>Number.isFinite(Number(r.value))); const failed=valid.filter(r=>Number(r.value)<0).length; const loss=valid.length?failed/valid.length*100:0; const last=[...item.records].reverse().find(r=>Number(r.value)>=0); const ping=last?Number(last.value):null;
      return <div key={item.task.key} className="hl-ping-chip" style={{borderColor:color}}><span style={{background:color}}/><strong>{def?.label ?? item.task.label}</strong><b>{ping==null?'超时':`${ping.toFixed(1)} ms`}</b><em>{loss.toFixed(1)}%</em></div>;
    })}</div>
    {showLoss && <div className="hl-loss-list">{ordered.map((item,index)=>{ const text=`${item.task.label} ${item.task.target}`; const def=netDefs.find(d=>d.re.test(text)); return <div className="hl-loss-row" key={item.task.key}><span>{def?.label ?? item.task.label}</span><div>{item.records.slice(-96).map((r,i)=><i key={`${r.time}-${i}`} className={Number(r.value)>=0?'ok':'bad'} />)}</div></div>; })}</div>}
    <div className="hl-ping-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{top:8,right:12,bottom:0,left:0}}><CartesianGrid strokeDasharray="3 3" opacity={0.18}/><XAxis dataKey="time" type="number" domain={xDomain} tickFormatter={(v)=>fmtTime(Number(v),range)} fontSize={10}/><YAxis width={52} domain={yDomain} tickFormatter={(v)=>`${Math.round(Number(v))} ms`} fontSize={10}/><Tooltip formatter={(v:number)=>`${Math.round(Number(v))} ms`}/>{ordered.map((item,index)=>{ const text=`${item.task.label} ${item.task.target}`; const def=netDefs.find(d=>d.re.test(text)); return <Line key={item.task.key} type={smooth?'monotone':'linear'} dataKey={item.task.key} name={def?.label ?? item.task.label} stroke={def?.color ?? item.task.color} strokeWidth={2.1} dot={false} connectNulls={connectNulls} isAnimationActive={false}/>; })}</LineChart></ResponsiveContainer></div>
  </>;
}

export default function InstanceMetricsDashboard(props: Props) {
  const [mode, setMode] = useState<Mode>('load');
  return <div className="hl-dashboard">
    <div className="hl-switch-row">
      <SegmentedControl.Root value={mode} onValueChange={v=>setMode(v as Mode)} size="2"><SegmentedControl.Item value="load">负载</SegmentedControl.Item><SegmentedControl.Item value="ping">Ping</SegmentedControl.Item></SegmentedControl.Root>
      <SegmentedControl.Root value={props.timeRange} onValueChange={props.onTimeRangeChange} size="2"><SegmentedControl.Item value="1h">1 小时</SegmentedControl.Item><SegmentedControl.Item value="12h">12 小时</SegmentedControl.Item><SegmentedControl.Item value="3d">3 天</SegmentedControl.Item></SegmentedControl.Root>
    </div>
    <Card className="hl-dashboard-card">
      {mode==='load' ? <><Flex justify="between" mb="3"><Text size="5" weight="bold">负载图表</Text><Text size="1" color="gray">最近 {rangeLabel[props.timeRange]}</Text></Flex><LoadPanel data={props.chartData} range={props.timeRange}/></> : <PingPanel series={props.pingSeries} range={props.timeRange} loading={props.pingLoading} error={props.pingError} onRefresh={props.onRefreshPing}/>} 
    </Card>
  </div>;
}
