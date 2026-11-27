import type { JobCardData } from '../types.ts';

/**
 * 设计基底四份虚构岗位样本（仅用于 demo.html 展示与对照，不写入生产默认空看板）。
 */
export function createDesignBaselineJobs(): JobCardData[] {
  return [
    {
      id: 'qinghe',
      version: 1,
      company: '青禾科技',
      position: '后端开发实习生',
      starred: true,
      result: null,
      steps: [
        { id: 'qinghe-s1', kind: 'applied' },
        {
          id: 'qinghe-s2',
          kind: 'interview',
          roundLabel: '一面',
          status: 'completed',
          scheduledAt: {
            precision: 'datetime',
            date: '2026-11-24',
            time: '14:00',
            label: '周二 14:00',
          },
        },
        {
          id: 'qinghe-s3',
          kind: 'interview',
          roundLabel: '二面',
          status: 'pending',
          scheduledAt: {
            precision: 'datetime',
            date: '2026-11-27',
            time: '15:00',
            label: '周五 15:00',
          },
        },
      ],
    },
    {
      id: 'qiyuan',
      version: 1,
      company: '栖原软件',
      position: '平台开发工程师',
      starred: false,
      result: 'rejected',
      steps: [
        {
          id: 'qiyuan-s1',
          kind: 'interview',
          roundLabel: '二面',
          status: 'completed',
        },
      ],
    },
    {
      id: 'shiguang',
      version: 1,
      company: '拾光数据',
      position: '数据工程实习生',
      starred: false,
      result: null,
      steps: [
        { id: 'shiguang-s1', kind: 'oc' },
        {
          id: 'shiguang-s2',
          kind: 'written_offer',
          deadline: {
            precision: 'datetime',
            date: '2026-11-26',
            time: '18:00',
            label: '周四 18:00',
          },
        },
      ],
    },
    {
      id: 'link-42',
      version: 1,
      company: '',
      position: '',
      url: 'https://jobs.example.com/p/42',
      starred: false,
      result: null,
      steps: [],
    },
  ];
}

/**
 * 边界验证样本：长公司名、多轮面试、仅日期期限、无日期面试与笔试截止。
 */
export function createEdgeCaseJobs(): JobCardData[] {
  return [
    {
      id: 'edge-long',
      version: 1,
      company: '中科智云协同计算与基础架构研究院有限公司（北京研发中心）',
      position: '分布式存储与高并发网关研发工程师（2027 届校园招聘提前批）',
      url: 'https://careers.example-cloud-infra.org/campus/2027/positions/distributed-gateway-8842',
      location: '北京 · 海淀',
      salary: '32k–40k × 16',
      jd: '负责大规模对象存储与接入层网关研发，熟悉 Go / Rust / Linux 网络栈优先。',
      starred: true,
      result: null,
      steps: [
        { id: 'edge-s1', kind: 'applied' },
        {
          id: 'edge-s2',
          kind: 'assessment',
          completed: true,
          deadline: {
            precision: 'date',
            date: '2026-11-20',
            label: '11月20日',
          },
        },
        {
          id: 'edge-s3',
          kind: 'interview',
          roundLabel: '一面',
          status: 'completed',
          scheduledAt: {
            precision: 'datetime',
            date: '2026-11-22',
            time: '10:30',
            label: '11月22日 10:30',
          },
        },
        {
          id: 'edge-s4',
          kind: 'interview',
          roundLabel: '二面',
          status: 'completed',
        },
        {
          id: 'edge-s5',
          kind: 'interview',
          roundLabel: '三面',
          status: 'completed',
        },
        {
          id: 'edge-s6',
          kind: 'interview',
          roundLabel: '终面',
          status: 'pending',
          scheduledAt: {
            precision: 'datetime',
            date: '2026-11-30',
            time: '19:00',
            label: '下周一 19:00',
          },
        },
      ],
    },
    {
      id: 'edge-date-only',
      version: 1,
      company: 'Northstar Systems',
      position: 'Platform Software Engineer (New Grad)',
      location: '上海',
      starred: false,
      result: 'declined',
      steps: [
        {
          id: 'edge-d1',
          kind: 'written_offer',
          deadline: {
            precision: 'date',
            date: '2026-12-05',
          },
        },
      ],
    },
    {
      id: 'edge-assessment',
      version: 1,
      company: '云起实验室',
      position: 'AI Infra 实习生',
      starred: false,
      result: null,
      steps: [
        {
          id: 'edge-a1',
          kind: 'assessment',
          completed: false,
          deadline: {
            precision: 'datetime',
            date: '2026-11-28',
            time: '23:59',
            label: '周六 23:59',
          },
        },
      ],
    },
  ];
}
