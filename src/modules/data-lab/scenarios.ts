/**
 * Pre-built simulation scenarios.
 *
 * Each Scenario exposes a `run(dispatch)` that calls the dispatcher with
 * synthesized events. Scenarios MUST NOT write directly to Redis state —
 * they feed the dispatcher just as real Reddit triggers do.
 */

import { dispatch } from '@shared/dispatcher.js';
import { synthesizeCommentEvent, synthesizePostEvent } from './synthetic.js';

export interface Scenario {
  name: string;
  description: string;
  run(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function simulatePost(
  title: string,
  body: string,
  author = 'lab_test_user_1',
): Promise<string> {
  const event = synthesizePostEvent({ title, body, author });
  await dispatch('onPostCreate', event);
  return (event.post as { id: string }).id;
}

async function simulateComment(
  postId: string,
  body: string,
  author = 'lab_test_user_1',
): Promise<void> {
  const event = synthesizeCommentEvent({ postId, body, author });
  await dispatch('onCommentCreate', event);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const crisisCluster: Scenario = {
  name: 'crisis-cluster',
  description: '8 negative bug posts in 30 min window, 20 angry comments — triggers an incident.',
  async run() {
    const negPosts = [
      ['App completely broken after latest update', 'Nothing works, I keep getting error 500.'],
      ['Crash on launch — reproducible every time', 'Opened app, instantly crashes. Rollback now.'],
      ['Lost all my data again', 'Third time this month. Unacceptable.'],
      ['Service down for 2 hours and counting', 'No updates from support. This is embarrassing.'],
      ['Critical bug in payment flow', 'Charges going through but orders not confirmed.'],
      ['Login broken for half our team', "People getting locked out. Can't work."],
      ['Notification spam bug is back', 'Getting 50 push notifications per minute.'],
      ['Export feature deletes data instead of exporting', 'Lost a week of work. Extremely upset.'],
    ];

    const postIds: string[] = [];
    for (const post of negPosts) {
      const id = await simulatePost(post[0] as string, post[1] as string, 'lab_angry_user');
      postIds.push(id);
      await sleep(20);
    }

    const angryComments = [
      'This is a disaster',
      'Absolute garbage',
      'I want a refund now',
      'How is this still happening?',
      'Zero response from support',
      'Switching to a competitor',
      'This is inexcusable',
      'Worst service ever',
      'My team is furious',
      'Fix this immediately or we cancel',
      'Stop ignoring us',
      'Been reporting this bug for months',
      'Completely unusable',
      'You have lost a customer today',
      'Shame on you',
      'This is illegal, we signed an SLA',
      'Never again',
      'Pathetic',
      'My boss is furious',
      'Escalating to legal',
    ];

    let ci = 0;
    for (const pid of postIds) {
      const count = Math.ceil(angryComments.length / postIds.length);
      for (let i = 0; i < count && ci < angryComments.length; i++, ci++) {
        await simulateComment(pid, angryComments[ci] ?? '', 'lab_angry_user');
        await sleep(10);
      }
    }
  },
};

const happyWeekend: Scenario = {
  name: 'happy-weekend',
  description: '12 positive praise posts simulating a good weekend support experience.',
  async run() {
    const praisePosts = [
      [
        'Amazing support experience!',
        'Your team resolved my issue in under 10 minutes. Incredible!',
      ],
      ['Just want to say thank you', 'Best product I have used in years. Keep up the great work.'],
      ['New update is fantastic', 'The new interface is clean and fast. Huge improvement over v2.'],
      ['Response time is incredible', 'Raised a ticket at 2am and had a fix by morning. Wow.'],
      ['Love the new feature', 'The batch export was exactly what we needed. Saved hours.'],
      ['Finally a product that just works', 'Migrated from a competitor. Zero regrets.'],
      [
        '5 stars all the way',
        'Renewing our enterprise contract for another year. Worth every penny.',
      ],
      [
        'The docs are excellent',
        'Everything I needed was documented clearly. First-time setup in 5 min.',
      ],
      ['Incredible value for money', 'We replaced three tools with this one. Cost dropped 60%.'],
      ['Support agent Sarah was amazing', 'Patient, knowledgeable, solved everything in one call.'],
      ['Smooth onboarding', 'My whole team was up and running in an afternoon. Impressive.'],
      [
        'Best decision we made this year',
        'Our customer satisfaction scores jumped after switching.',
      ],
    ];
    for (const post of praisePosts) {
      await simulatePost(post[0] as string, post[1] as string, 'lab_happy_user');
      await sleep(20);
    }
  },
};

const slaBreach: Scenario = {
  name: 'sla-breach',
  description: '5 posts that arrive unanswered — triggers SLA breach detection.',
  async run() {
    const breachPosts = [
      ['Billing error on my invoice', 'Charged twice for the same month. Please fix ASAP.'],
      ['Account access locked out', 'Cannot log in. Support ticket open for 3 days.'],
      ['Feature broken in production', 'Our whole workflow is stopped. Need urgent help.'],
      ['Subscription cancelled but still being charged', 'Cancelled 2 weeks ago, still billed.'],
      ['Integration API returning 401 errors', 'Production integration broken since yesterday.'],
    ];
    for (const post of breachPosts) {
      await simulatePost(post[0] as string, post[1] as string, 'lab_sla_user');
      await sleep(20);
    }
    // No agent comments — SLA module will detect no response
  },
};

const mixedBrandMentions: Scenario = {
  name: 'mixed-brand-mentions',
  description: '15 posts mixing brand + 3 competitor names for comparison analysis.',
  async run() {
    const competitors = ['CompeteX', 'RivalSoft', 'OtherBrand'];
    const templates = [
      (comp: string) => [
        `Switching from ${comp}`,
        `We used ${comp} for years but decided to try this.`,
      ],
      (comp: string) => [`${comp} vs this product`, `Comparing ${comp} to this for our team.`],
      (comp: string) => [
        `Why we left ${comp}`,
        `${comp} pricing went up 3x. Looking for alternatives.`,
      ],
      (comp: string) => [`Better than ${comp}?`, `Anyone else find this outperforms ${comp}?`],
      (comp: string) => [
        `${comp} integration possible?`,
        `We still use ${comp} for X. Can they integrate?`,
      ],
    ];
    for (const comp of competitors) {
      for (const tpl of templates) {
        const pair = tpl(comp);
        await simulatePost(pair[0] as string, pair[1] as string, 'lab_brand_analyst');
        await sleep(20);
      }
    }
  },
};

const rootCauseTest: Scenario = {
  name: 'root-cause-test',
  description: '5 resolved posts each with an agent reply — seeds the root-cause pipeline.',
  async run() {
    const rcPosts = [
      ['App keeps freezing', 'Every 10 minutes the app freezes for ~5 seconds.'],
      ['Data not syncing across devices', 'Phone and desktop are out of sync for hours.'],
      ['Email notifications not sending', 'Set up notifications but never receive emails.'],
      ['Search results wrong', 'Searching "invoice" shows completely unrelated results.'],
      ['Dark mode not saving', 'Switch to dark mode, close app, it resets to light.'],
    ];
    for (const post of rcPosts) {
      const postId = await simulatePost(post[0] as string, post[1] as string, 'lab_test_user_1');
      await sleep(20);
      await simulateComment(
        postId,
        `Hi! This is a known issue on our end — we are actively working on a fix. Expected resolution: 24h. We will update this thread.`,
        'lab_agent_1',
      );
      await sleep(20);
    }
  },
};

export const SCENARIOS: Scenario[] = [
  crisisCluster,
  happyWeekend,
  slaBreach,
  mixedBrandMentions,
  rootCauseTest,
];

export function findScenario(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
