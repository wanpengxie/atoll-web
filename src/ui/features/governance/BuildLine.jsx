import React from 'react';
import {
  buildAttemptLabel,
  buildObjectLabel,
  buildRecord,
  buildResultLabel,
  buildStateLabel,
  buildTone,
} from '../../../model/build-record.js';

// 一条构建记录：结果、第几次尝试、用的是哪一版描述和配置、失败原因。
export function BuildLine({ record, label = '' }) {
  const build = buildRecord(record);
  if (!build) return null;
  return <div className={`build-line build-${buildTone(build)}`} data-build-object={build.object.kind} data-build-name={build.object.name || undefined} data-build-config={build.object.configId || undefined} data-build-generated={build.object.generated || undefined}>
    <strong>{label || buildObjectLabel(build)}</strong>
    <span>{buildResultLabel(build)}{build.state ? ` · ${buildStateLabel(build)}` : ''}</span>
    <small>{buildAttemptLabel(build)} · 描述第 {build.channelRevision} 版{build.actor ? ` · ${build.actor}` : ''}{build.configRevision != null ? ` · 配置第 ${build.configRevision} 版` : ''}</small>
    {build.reason && <p className="build-reason">{build.reason}</p>}
  </div>;
}
