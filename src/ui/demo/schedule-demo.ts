import '../styles/fonts.ts';
import { createJobBoardApp, type JobBoardAppHandle } from '../workspace/app.ts';
import type { SchedulePageId } from '../workspace/schedule-navigation.ts';
import {
  createDemoTodayDate,
  createIsolatedDemoStore,
  resolveScheduleScenario,
  SCHEDULE_DEMO_TODAY,
  SCHEDULE_SCENARIOS,
  type ScheduleScenarioId,
} from './schedule-scenarios.ts';

function parseDemoView(raw: string | null): SchedulePageId | null {
  if (raw === 'board' || raw === 'calendar' || raw === 'timeline') {
    return raw;
  }
  return null;
}

function injectDemoStyles(): void {
  if (document.getElementById('zj-schedule-demo-style')) return;
  const style = document.createElement('style');
  style.id = 'zj-schedule-demo-style';
  style.textContent = `
    .zj-schedule-demo-bar {
      background: var(--zj-panel);
      border-bottom: 1px solid var(--zj-line);
      padding: 8px 16px;
    }
    .zj-schedule-demo-bar-inner {
      max-width: 1380px;
      margin: 0 auto;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      min-width: 0;
    }
    .zj-schedule-demo-meta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--zj-muted);
      white-space: nowrap;
    }
    .zj-schedule-demo-badge {
      padding: 2px 7px;
      border-radius: var(--zj-radius-badge, 4px);
      background: var(--zj-blue-bg);
      color: var(--zj-blue);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .zj-schedule-demo-scenes {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      flex: 1 1 320px;
      min-width: 0;
    }
    .zj-schedule-demo-chip {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 0 9px;
      border-radius: 6px;
      background: var(--zj-subtle);
      color: var(--zj-text);
      font-size: 12px;
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
    }
    .zj-schedule-demo-chip:hover {
      background: var(--zj-soft);
    }
    .zj-schedule-demo-chip.is-active {
      background: var(--zj-blue-bg);
      color: var(--zj-blue);
      font-weight: 600;
    }
    .zj-schedule-demo-tools {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
    }
    @media (max-width: 767px) {
      .zj-schedule-demo-bar {
        padding: 8px 12px;
      }
      .zj-schedule-demo-tools {
        margin-left: 0;
      }
    }
  `;
  document.head.append(style);
}

export function mountScheduleDemo(container: HTMLElement): {
  destroy: () => void;
  setScenario: (id: ScheduleScenarioId, view?: SchedulePageId | null) => void;
} {
  injectDemoStyles();

  const root = document.createElement('div');
  root.className = 'zj-ui-scope zj-schedule-demo-root';

  const bar = document.createElement('aside');
  bar.className = 'zj-schedule-demo-bar';
  bar.setAttribute('aria-label', '样例场景切换');

  const inner = document.createElement('div');
  inner.className = 'zj-schedule-demo-bar-inner';

  const meta = document.createElement('div');
  meta.className = 'zj-schedule-demo-meta';
  const todayBadge = document.createElement('span');
  todayBadge.className = 'zj-schedule-demo-badge';
  todayBadge.dataset.demoToday = SCHEDULE_DEMO_TODAY;
  todayBadge.textContent = `今天 ${SCHEDULE_DEMO_TODAY}`;
  const isolatedText = document.createElement('span');
  isolatedText.textContent = '样例隔离';
  meta.append(todayBadge, isolatedText);

  const sceneNav = document.createElement('nav');
  sceneNav.className = 'zj-schedule-demo-scenes';
  sceneNav.setAttribute('aria-label', '十种日程场景');

  const tools = document.createElement('div');
  tools.className = 'zj-schedule-demo-tools';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'zj-schedule-demo-chip';
  resetBtn.dataset.action = 'reset-scene';
  resetBtn.textContent = '重置场景';

  const cardsDemoLink = document.createElement('a');
  cardsDemoLink.className = 'zj-schedule-demo-chip';
  cardsDemoLink.href = './demo.html';
  cardsDemoLink.textContent = '卡片验证台';

  tools.append(resetBtn, cardsDemoLink);
  inner.append(meta, sceneNav, tools);
  bar.append(inner);

  const boardHost = document.createElement('div');
  boardHost.className = 'zj-schedule-demo-board';

  root.append(bar, boardHost);
  container.replaceChildren(root);

  let activeScenario = resolveScheduleScenario(
    new URLSearchParams(window.location.search).get('scene'),
  );
  let appHandle: JobBoardAppHandle | null = null;

  const sceneLinks = new Map<ScheduleScenarioId, HTMLAnchorElement>();
  for (const def of SCHEDULE_SCENARIOS) {
    const link = document.createElement('a');
    link.className = 'zj-schedule-demo-chip';
    link.href = `?scene=${encodeURIComponent(def.id)}`;
    link.dataset.scene = def.id;
    link.textContent = def.label;
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      loadScenario(def.id, null, true);
    });
    sceneNav.append(link);
    sceneLinks.set(def.id, link);
  }

  function syncUrl(sceneId: ScheduleScenarioId, replaceHistory: boolean): void {
    const url = new URL(window.location.href);
    url.searchParams.set('scene', sceneId);
    if (replaceHistory && typeof window.history?.replaceState === 'function') {
      window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
    }
  }

  function syncActiveChip(): void {
    for (const [id, link] of sceneLinks) {
      const active = id === activeScenario.id;
      link.classList.toggle('is-active', active);
      link.setAttribute('aria-current', active ? 'true' : 'false');
    }
  }

  function loadScenario(
    scenarioId: ScheduleScenarioId,
    targetView: SchedulePageId | null,
    pushUrl: boolean,
  ): void {
    activeScenario = resolveScheduleScenario(scenarioId);
    syncActiveChip();
    if (pushUrl) {
      syncUrl(activeScenario.id, true);
    }

    appHandle?.destroy();
    const store = createIsolatedDemoStore(activeScenario.createJobs());
    appHandle = createJobBoardApp({
      container: boardHost,
      store,
      scheduleToday: createDemoTodayDate(),
    });
    if (targetView) {
      appHandle.setActivePage(targetView);
    }
  }

  resetBtn.addEventListener('click', () => {
    const currentView = appHandle?.getActivePage() ?? null;
    loadScenario(activeScenario.id, currentView, false);
  });

  const initialParams = new URLSearchParams(window.location.search);
  const initialView = parseDemoView(initialParams.get('view'));
  loadScenario(activeScenario.id, initialView, false);

  return {
    setScenario(id, view = null) {
      loadScenario(id, view, true);
    },
    destroy() {
      appHandle?.destroy();
      appHandle = null;
      root.remove();
    },
  };
}

if (typeof document !== 'undefined') {
  const mount = document.getElementById('schedule-demo-app');
  if (mount) {
    mountScheduleDemo(mount);
  }
}
