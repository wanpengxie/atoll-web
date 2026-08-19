// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StructuredResult } from '../src/ui/StructuredResult.jsx';

afterEach(cleanup);

it('纯 JSON 文本结果默认收起，用户点击后才展开', async () => {
  const user = userEvent.setup();
  const view = render(<StructuredResult requestType="agent.ask" payload={{ status: 'completed', text: '{"items":[1,2,3],"ok":true}' }} />);
  const details = view.container.querySelector('.structured-result-details');
  expect(details.open).toBe(false);
  expect(screen.getByText('JSON 结果')).toBeTruthy();
  expect(screen.getByText('2 个字段')).toBeTruthy();
  await user.click(screen.getByText('JSON 结果'));
  expect(details.open).toBe(true);
  expect(screen.getByText('收起')).toBeTruthy();
});

it('结构化协议结果默认收起并限制在独立滚动区', () => {
  const view = render(<StructuredResult requestType="system.channel.get" payload={{ status: 'completed', id: 'c0', profile: { serving: 1 } }} />);
  const details = view.container.querySelector('.structured-result-details');
  expect(details.open).toBe(false);
  expect(view.container.querySelector('.structured-result-scroll')).toBeTruthy();
  expect(screen.getByText('结构化结果')).toBeTruthy();
});
