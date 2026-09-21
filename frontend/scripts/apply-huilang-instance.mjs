import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('src/pages/Instance.tsx');
let text = fs.readFileSync(file, 'utf8');
const replaceOnce = (from, to, label) => {
  if (text.includes(to)) return;
  if (!text.includes(from)) throw new Error(`Huilang patch failed: ${label}`);
  text = text.replace(from, to);
};

replaceOnce(
  "import PingYAxisTick from '../components/PingYAxisTick';",
  "import PingYAxisTick from '../components/PingYAxisTick';\nimport InstanceMetricsDashboard from '../components/InstanceMetricsDashboard';",
  'dashboard import',
);

replaceOnce("type TimeRange = '1h' | '4h' | '24h' | '3d';", "type TimeRange = '1h' | '12h' | '3d';", 'time range type');
replaceOnce(
`const timeRangeMs: Record<TimeRange, number> = {
  '1h': 3600000,
  '4h': 14400000,
  '24h': 86400000,
  '3d': 259200000,
};`,
`const timeRangeMs: Record<TimeRange, number> = {
  '1h': 3600000,
  '12h': 43200000,
  '3d': 259200000,
};`, 'time range ms');
replaceOnce(
`const timeRangeHours: Record<TimeRange, number> = {
  '1h': 1,
  '4h': 4,
  '24h': 24,
  '3d': 72,
};`,
`const timeRangeHours: Record<TimeRange, number> = {
  '1h': 1,
  '12h': 12,
  '3d': 72,
};`, 'time range hours');
replaceOnce(
`const timeRangePointLimit: Record<TimeRange, number> = {
  '1h': 240,
  '4h': 360,
  '24h': 720,
  '3d': 1000,
};`,
`const timeRangePointLimit: Record<TimeRange, number> = {
  '1h': 240,
  '12h': 720,
  '3d': 1000,
};`, 'point limits');

replaceOnce(
  "  const [pingError, setPingError] = useState<string | null>(null);",
  "  const [pingError, setPingError] = useState<string | null>(null);\n  const [pingRefresh, setPingRefresh] = useState(0);",
  'ping refresh state',
);

const oldLazy = `  useEffect(() => {
    if (shouldLoadPing) return;
    const target = pingSectionRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      setShouldLoadPing(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoadPing(true);
      observer.disconnect();
    }, { rootMargin: '240px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldLoadPing, uuid]);`;
const newLazy = `  useEffect(() => {
    setShouldLoadPing(true);
  }, [uuid]);`;
replaceOnce(oldLazy, newLazy, 'ping lazy loading');

replaceOnce(
  "  }, [shouldLoadPing, timeRange, uuid, authLoading, isAuthenticated]);",
  "  }, [shouldLoadPing, timeRange, uuid, authLoading, isAuthenticated, pingRefresh]);",
  'ping refresh dependency',
);

replaceOnce(
  "    return timeRange === '24h' || timeRange === '3d'",
  "    return timeRange === '3d'",
  'time formatter',
);

const anchor = `      {/* Chart section */}`;
const dashboard = `      <InstanceMetricsDashboard
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        chartData={chartRenderData}
        pingSeries={pingSeries}
        pingLoading={pingLoading}
        pingError={pingError}
        onRefreshPing={() => setPingRefresh((value) => value + 1)}
      />

      {/* Chart section */}`;
replaceOnce(anchor, dashboard, 'dashboard insertion');
replaceOnce('      <Card mb="4">', '      <Card className="cfsm-legacy-chart-card" mb="4">', 'legacy chart class');
replaceOnce('      <div ref={pingSectionRef}>', '      <div ref={pingSectionRef} className="cfsm-legacy-ping-card">', 'legacy ping class');

text = text.replace(
  "监控图表 · {timeRange === '1h' ? '最近1小时' : timeRange === '4h' ? '最近4小时' : timeRange === '24h' ? '最近24小时' : '最近3天'}",
  "监控图表 · {timeRange === '1h' ? '最近1小时' : timeRange === '12h' ? '最近12小时' : '最近3天'}",
);
text = text.replace(
`              <SegmentedControl.Item value="1h">1小时</SegmentedControl.Item>
              <SegmentedControl.Item value="4h">4小时</SegmentedControl.Item>
              <SegmentedControl.Item value="24h">24小时</SegmentedControl.Item>
              <SegmentedControl.Item value="3d">3天</SegmentedControl.Item>`,
`              <SegmentedControl.Item value="1h">1小时</SegmentedControl.Item>
              <SegmentedControl.Item value="12h">12小时</SegmentedControl.Item>
              <SegmentedControl.Item value="3d">3天</SegmentedControl.Item>`,
);

fs.writeFileSync(file, text, 'utf8');
console.log('Huilang instance dashboard patch applied.');
