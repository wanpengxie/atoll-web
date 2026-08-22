// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { normalizeAgentSelection } from '../src/model/agent-selection.js';
import { ModelSelector } from '../src/ui/ModelSelector.jsx';

afterEach(cleanup);

const value = {
  actorId: 'steward',
  current: { model: 'gpt-5.6-sol', effort: 'medium' },
  models: [{ id: 'gpt-5.6-sol', label: '5.6 Sol' }, { id: 'gpt-5.6-terra', label: '5.6 Terra' }],
  efforts: [{ id: 'light', label: '轻量' }, { id: 'medium', label: '中等' }, { id: 'high', label: '高' }],
};

describe('Model/Effort 选择器', () => {
  it('把后端观察值收敛成与 UI 解耦的模型', () => {
    expect(normalizeAgentSelection({ declared: { actor_id: 'steward', current: { model: 'm1', effort: 'high' }, models: [{ id: 'm1', name: '模型一' }], efforts: ['high'] } })).toEqual({
      actorId: 'steward', current: { model: 'm1', effort: 'high' }, models: [{ id: 'm1', label: '模型一' }], efforts: [{ id: 'high', label: 'high' }],
    });
  });

  it('只有 Model 与 Effort 两级，不出现 Speed，并提交完整选择', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<ModelSelector value={value} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /模型 5.6 Sol，推理强度 中等/ }));
    expect(screen.getByRole('menuitem', { name: /模型/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /推理强度/ })).toBeTruthy();
    expect(screen.queryByText(/Speed/i)).toBeNull();

    await user.click(screen.getByRole('menuitem', { name: /推理强度/ }));
    await user.click(screen.getByRole('menuitemradio', { name: '高' }));
    expect(onChange).toHaveBeenCalledWith({ actorId: 'steward', model: 'gpt-5.6-sol', effort: 'high' });
  });
});
