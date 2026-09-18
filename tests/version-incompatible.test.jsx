// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionIncompatible } from '../src/ui/VersionIncompatible.jsx';

describe('version incompatible surface', () => {
  it('explains that the old page stopped and exposes one explicit refresh action', () => {
    const refresh = vi.fn();
    render(<VersionIncompatible expectedVersion={5} receivedVersion={6} onRefresh={refresh} />);

    expect(screen.getByRole('alert').textContent).toContain('这个页面的版本已经过期');
    expect(screen.getByRole('alert').textContent).toContain('当前会话已经停止');
    expect(screen.getByText('当前页面使用协议 v5，服务端已使用 v6')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '刷新页面' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
