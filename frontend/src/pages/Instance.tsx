import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Flex,
  Card,
  Text,
  Badge,
  Heading,
  Button,
  Box,
} from '@radix-ui/themes';
import {
  ArrowLeft,
  Server,
  Globe,
  Activity,
  Layers,
} from 'lucide-react';
import Loading from '../components/Loading';
import DetailsGrid from '../components/DetailsGrid';
import Flag from '../components/Flag';
import InstanceMetricsDashboard, { type InstanceDashboardRange } from '../components/InstanceMetricsDashboard';
import { useLiveData } from '../contexts/LiveDataContext';
import { useAuth } from '../contexts/AuthContext';
import { publicFetch } from '../utils/api';
import { normalizePublicClients } from '../utils/publicClients';
import {
  collectCursorHistory,
  normalizePublicGpuRecords,
  normalizePublicMonitorRecords,
  type PublicMonitorRecord,
} from '../utils/publicHistory';
import type { ClientInfo, LiveDataMap } from '../types';
import {
  formatLastReport,
  formatMetricUptime,
  getNodeDisplayRecord,
  getNodeLastReportTime,
  getNodeStatus,
} from '../utils/nodeMetrics';
import { filterMonitorNodes } from '../utils/monitorView';
import { fetchPingTaskSeries, type PingTaskSeries } from '../utils/pingChart';
import { buildMonitorChartData, getMonitorChartRenderData } from '../utils/monitorChartData';

type TimeRange = InstanceDashboardRange;

const timeRangeMs: Record<TimeRange, number> = {
  '1h': 3600000,
  '12h': 43200000,
  '3d': 259200000,
};

const timeRangeHours: Record<TimeRange, number> = {
  '1h': 1,
  '12h': 12,
  '3d': 72,
};

const timeRangePointLimit: Record<TimeRange, number> = {
  '1h': 240,
  '12h': 720,
  '3d': 1000,
};

function historyQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.toString();
}

export default function Instance() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const { authLoading, isAuthenticated } = useAuth();
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [records, setRecords] = useState<PublicMonitorRecord[]>([]);
  const [clientLoading, setClientLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [, setGpuRecords] = useState<ReturnType<typeof normalizePublicGpuRecords>>([]);
  const [, setGpuLoading] = useState(false);
  const [, setGpuError] = useState<string | null>(null);
  const clientRequestRef = useRef(0);
  const recordsRequestRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [recordsRangeEnd, setRecordsRangeEnd] = useState(() => Date.now());
  const [pingSeries, setPingSeries] = useState<PingTaskSeries[]>([]);
  const [pingLoading, setPingLoading] = useState(false);
  const [pingError, setPingError] = useState<string | null>(null);
  const [pingRefresh, setPingRefresh] = useState(0);
  const { liveData, snapshotReady } = useLiveData();

  const liveView: LiveDataMap = useMemo(() => ({
    online: liveData?.online || [],
    data: liveData?.data || {},
    clients: liveData?.clients || [],
    last_known: liveData?.last_known || {},
    statusReady: snapshotReady,
  }), [liveData, snapshotReady]);

  const liveRecord = uuid ? getNodeDisplayRecord(uuid, liveView) : undefined;
  const nodeStatus = uuid ? getNodeStatus(uuid, liveView) : 'unknown';
  const onlineSet = useMemo(() => new Set(liveData?.online || []), [liveData?.online]);

  const groupedClients = useMemo(() => {
    const sorted = filterMonitorNodes(clients, liveView, { offlinePosition: 'last' });
    const groups = new Map<string, ClientInfo[]>();

    sorted.forEach((node) => {
      const groupName = node.group?.trim() || '未分组';
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName)!.push(node);
    });

    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === '未分组') return 1;
        if (b === '未分组') return -1;
        return a.localeCompare(b);
      })
      .map(([group, nodes]) => ({ group, nodes }));
  }, [clients, liveView]);

  const loadClient = useCallback(async (signal?: AbortSignal) => {
    if (!uuid || authLoading) return;
    const requestId = ++clientRequestRef.current;
    setClientLoading(true);
    setClient(null);

    try {
      setError(null);
      const data = await publicFetch(`/nodes${isAuthenticated ? '?include_hidden=1' : ''}`, { signal });
      if (signal?.aborted || requestId !== clientRequestRef.current) return;
      const visible = normalizePublicClients(data, { includeHidden: isAuthenticated });
      setClients(visible);
      const found = visible.find((item) => item.uuid === uuid) || null;
      if (found) setClient(found);
      else setError('服务器不存在');
    } catch {
      if (!signal?.aborted && requestId === clientRequestRef.current) setError('加载失败');
    } finally {
      if (!signal?.aborted && requestId === clientRequestRef.current) setClientLoading(false);
    }
  }, [uuid, authLoading, isAuthenticated]);

  useEffect(() => {
    const controller = new AbortController();
    void loadClient(controller.signal);
    return () => {
      controller.abort();
      clientRequestRef.current += 1;
    };
  }, [loadClient]);

  const loadRecords = useCallback(async (range: TimeRange, signal?: AbortSignal) => {
    if (!uuid || authLoading) return;
    const requestId = ++recordsRequestRef.current;
    setRecordsLoading(true);
    setRecords([]);
    setRecordsError(null);

    const endTs = Date.now();
    const startTs = endTs - timeRangeMs[range];
    const start = new Date(startTs).toISOString();
    const end = new Date(endTs).toISOString();
    const limit = timeRangePointLimit[range];
    setRecordsRangeEnd(endTs);

    try {
      const data = await collectCursorHistory(
        (cursor) => publicFetch(
          `/records/load?${historyQuery({
            uuid,
            start,
            end,
            cursor,
            limit: Math.min(limit, 500),
            include_hidden: isAuthenticated ? 1 : undefined,
          })}`,
          { signal },
        ),
        {
          cursor: end,
          start,
          end,
          normalize: normalizePublicMonitorRecords,
          signal,
        },
      );
      if (!signal?.aborted && requestId === recordsRequestRef.current) setRecords(data);
    } catch {
      if (!signal?.aborted && requestId === recordsRequestRef.current) {
        setRecordsError('加载监控历史失败，请重试');
      }
    } finally {
      if (!signal?.aborted && requestId === recordsRequestRef.current) setRecordsLoading(false);
    }
  }, [uuid, authLoading, isAuthenticated]);

  useEffect(() => {
    const controller = new AbortController();
    void loadRecords(timeRange, controller.signal);
    return () => {
      controller.abort();
      recordsRequestRef.current += 1;
    };
  }, [loadRecords, timeRange]);

  useEffect(() => {
    if (!uuid || authLoading) return;
    const controller = new AbortController();
    setPingSeries([]);
    setPingError(null);
    setPingLoading(true);

    fetchPingTaskSeries(uuid, {
      limit: 360,
      maxTasks: 8,
      rangeHours: timeRangeHours[timeRange],
      cursor: new Date().toISOString(),
      includeHidden: isAuthenticated,
      signal: controller.signal,
    })
      .then((series) => {
        if (!controller.signal.aborted) setPingSeries(series);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPingError('加载 Ping 数据失败');
          setPingSeries([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPingLoading(false);
      });

    return () => controller.abort();
  }, [timeRange, uuid, authLoading, isAuthenticated, pingRefresh]);

  useEffect(() => {
    setGpuRecords([]);
    setGpuError(null);
    setGpuLoading(false);
    if (!uuid || authLoading || !client?.gpu_name || client.uuid !== uuid) return;
    setGpuLoading(true);
    const controller = new AbortController();
    const endTs = Date.now();
    const startTs = endTs - timeRangeMs[timeRange];
    const start = new Date(startTs).toISOString();
    const end = new Date(endTs).toISOString();

    collectCursorHistory(
      (cursor) => publicFetch(`/records/gpu?${historyQuery({
        uuid,
        start,
        end,
        cursor,
        limit: 500,
        include_hidden: isAuthenticated ? 1 : undefined,
      })}`, { signal: controller.signal }),
      {
        cursor: end,
        start,
        end,
        normalize: normalizePublicGpuRecords,
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (!controller.signal.aborted) setGpuRecords(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setGpuError('加载 GPU 历史失败，请重试');
      })
      .finally(() => {
        if (!controller.signal.aborted) setGpuLoading(false);
      });

    return () => controller.abort();
  }, [uuid, timeRange, client?.uuid, client?.gpu_name, authLoading, isAuthenticated]);

  const handleTimeRangeChange = (value: string) => {
    setTimeRange(value as TimeRange);
    setRecords([]);
    setRecordsLoading(true);
  };

  if (clientLoading || (client && client.uuid !== uuid) || (recordsLoading && records.length === 0)) {
    return <Loading />;
  }
  if (error || !client) {
    return <Text color="red" align="center" style={{ padding: 40 }}>{error || '未找到'}</Text>;
  }

  const latestHistory = records.length > 0 ? records[records.length - 1] : null;
  const latest = liveRecord || latestHistory;
  const latestRecordTime = liveRecord
    ? getNodeLastReportTime(uuid || '', liveView)
    : latestHistory
      ? Date.parse(latestHistory.time)
      : undefined;

  const chartData = buildMonitorChartData(records);
  const chartRenderData = getMonitorChartRenderData(chartData, timeRangeMs[timeRange], recordsRangeEnd);

  return (
    <div className="instance-page">
      <div className="instance-shell">
        <InstanceNodeSidebar
          groups={groupedClients}
          activeUuid={uuid || ''}
          onlineSet={onlineSet}
          statusReady={snapshotReady}
          liveData={liveData?.data || {}}
          onSelect={(nextUuid) => navigate(`/instance/${nextUuid}`)}
        />

        <section className="instance-detail-panel">
          <Flex justify="between" align="center" mb="4">
            <Button variant="ghost" onClick={() => navigate('/')}>
              <ArrowLeft size={16} /> 返回
            </Button>
          </Flex>

          <Card className="instance-top-summary" mb="3">
            <Flex align="center" gap="3" wrap="wrap" className="instance-top-summary-header">
              <Server size={26} color="var(--accent-9)" />
              <Heading size="5">{client.name}</Heading>
              {client.region && <Badge color="gray"><Globe size={12} /> {client.region}</Badge>}
              {client.group && <Badge color="purple"><Layers size={12} /> {client.group}</Badge>}
              <Badge
                color={nodeStatus === 'online' ? 'green' : nodeStatus === 'offline' ? 'red' : 'gray'}
                variant="solid"
              >
                <Activity size={12} />{' '}
                {nodeStatus === 'online'
                  ? `在线 · 已运行 ${formatMetricUptime(latest?.uptime)}`
                  : nodeStatus === 'offline'
                    ? '离线'
                    : '确认中'}
              </Badge>
              {nodeStatus === 'offline' && (
                <Text size="1" color="gray">
                  最后上报 {formatLastReport(latestRecordTime)} · 上报时已运行 {formatMetricUptime(latest?.uptime)}
                </Text>
              )}
            </Flex>
            <DetailsGrid client={client} live={latest || undefined} compact remark={client.public_remark} />
          </Card>

          {recordsError && (
            <Flex align="center" gap="2" mb="3">
              <Text color="red" role="alert">{recordsError}</Text>
              <Button size="1" variant="soft" onClick={() => void loadRecords(timeRange)}>重试</Button>
            </Flex>
          )}

          <InstanceMetricsDashboard
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
            chartData={chartRenderData}
            pingSeries={pingSeries}
            pingLoading={pingLoading}
            pingError={pingError}
            onRefreshPing={() => setPingRefresh((value) => value + 1)}
          />
        </section>
      </div>
    </div>
  );
}

function InstanceNodeSidebar({
  groups,
  activeUuid,
  onlineSet,
  statusReady,
  liveData,
  onSelect,
}: {
  groups: Array<{ group: string; nodes: ClientInfo[] }>;
  activeUuid: string;
  onlineSet: Set<string>;
  statusReady: boolean;
  liveData: Record<string, Partial<PublicMonitorRecord>>;
  onSelect: (uuid: string) => void;
}) {
  const total = groups.reduce((sum, group) => sum + group.nodes.length, 0);

  return (
    <aside className="instance-node-sidebar" aria-label="节点列表">
      <Card className="instance-node-sidebar-card">
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
          <Flex justify="between" align="center" className="instance-sidebar-header">
            <Box>
              <Text size="2" weight="bold" style={{ display: 'block' }}>节点列表</Text>
              <Text size="1" color="gray">{statusReady ? onlineSet.size : '—'} / {total} 在线</Text>
            </Box>
          </Flex>

          <Box className="instance-sidebar-scroll">
            {groups.map((group) => (
              <Box key={group.group}>
                <div className="instance-sidebar-group">
                  {group.group} ({group.nodes.length})
                </div>
                {group.nodes.map((node) => {
                  const isActive = node.uuid === activeUuid;
                  const isOnline = onlineSet.has(node.uuid);
                  const live = liveData[node.uuid];

                  return (
                    <button
                      key={node.uuid}
                      type="button"
                      className={`instance-sidebar-node${isActive ? ' is-active' : ''}`}
                      onClick={() => onSelect(node.uuid)}
                      title={node.name}
                    >
                      <span
                        className={`instance-sidebar-status${isOnline ? ' is-online' : statusReady ? ' is-offline' : ''}`}
                        aria-hidden="true"
                      />
                      <Flag region={node.region} size={16} />
                      <span className="instance-sidebar-node-main">
                        <span className="instance-sidebar-node-name">{node.name}</span>
                        <span className="instance-sidebar-node-meta">
                          {isOnline
                            ? `CPU ${typeof live?.cpu === 'number' ? `${live.cpu.toFixed(0)}%` : '—'}`
                            : statusReady
                              ? '离线'
                              : '确认中'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </Box>
            ))}
          </Box>
        </Flex>
      </Card>
    </aside>
  );
}
