# 历史供给链证明义务（审查中，非正确性认证）

当前产品基线 ea6735c。目标不是证明若干样例，而是把所有生产出口归入同一生命周期；未逐一映射的项不可宣布成立。

## 必须分开的事实

- sourceEOF：当前有效源没有更早的页，不证明已缓冲事实被消费。
- bufferDrained：当前缓冲为空，不证明其他有效源或当前在途操作已耗尽。
- projectionSatisfied：当前语义目标已由投影达到，不证明当前视口已填满或DOM已提交。
- presentationCommitted：同身份投影已提交，不证明用户新的需求也已满足。
- demandClosed：只能由需求所有者根据以上事实与当前目标决定；任何单页回调无此独立权限。

## 状态与交接合同

| 需求状态 | 输入 | 必须的后继及责任 |
|---|---|---|
| 未满足 | 可消费buffer | 单一需求所有者安排有界release；不等待用户重进 |
| 未满足 | 无buffer，有可读源 | 将同一需求交给既有Scheduler；排队责任不可丢失 |
| 执行中 | 同义务新的供给进展 | 当前执行消费该进展，或保留一个后继；不能只返回旧Promise并遗忘新进展 |
| 执行中 | 页完成或零匹配 | 更新事实，重新判目标；不是自动需求完成 |
| 执行中 | 旧操作EOF迟到 | 仅影响它所证明的源/版本；不得证明后来供给或新目标已耗尽 |
| 待展示 | 同身份Presentation提交 | 重判当前需求；若视口仍未满足且有供给，继续原义务 |
| 任意非终态 | 撤权、world/view/activation替换 | 旧义务取消；旧回调不能完成或修改继任义务 |
| 任意非终态 | 失败/不可用 | 显式失败或有解除条件的等待；保留重试责任与可见反馈，不默认为空 |
| 可结束 | 目标已满足，或全部有效源耗尽且buffer排空 | 当前所有者一次性结束；随后新目标/供给不能被旧完成记忆永久拒绝 |

## 证明需要落到的当前代码

1. Scheduler `snapshot/beginOperation/nextSegment/commit/publish`：物理结果、供给版本、订阅唤醒。
2. Feed `historyFor/loadHistory`：状态传递、语义目标、projection/admission、每个return和finally release。
3. Reading `requestHistory`：去重、runway attempt、EOF/failed记忆、source交接、取消、settlement successor。
4. Following underfill与零行Reading入口：声明需求，不得把被拒绝的调用当作已被承接。
5. Presentation admission及DOM提交：目标满足与呈现回执的区别，谁在等待时持有义务。

## 推进性前提及限制

网络不保证最终成功；保证在deadline后明确失败。浏览器若停止执行JS，不承诺墙钟内完成；恢复后必须继续或终结。IDB事务若连abort都不settle，持久化必须保安全fence并明确降级，不能虚报落盘。活跃执行环境、有限一次处理预算及公平调度下，未满足需求不得无所有者地处于idle。

## 当前尚未证明

完整消费义务分散在UI effect、Reading Promise、Feed循环、Scheduler operation和Presentation admission；目前没有完成所有退出路径的归纳检查。EOF去重候选仍在隔离中，不能因两个反例通过而认为上述合同已成立。接下来以转移表逐路径核实保留、移交、关闭，必要时重划所有权并删除重复完成权威。

## 逐转移实审结果：当前实现不成立

本轮root核对源码与独立转移表，不能签整体正确：

- Reading远端EOF记忆不绑定实际供给生命周期；K0结束后K1新buffer仍被永久拒绝。仅在settle时读取当前K1写证书也错误，证书必须属于产生结果的attempt。
- 新供给在旧attempt尚未结束时到达，上游已消耗wake，下游只合并到旧Promise；旧attempt结束时没有保证重新判当前需求。
- Admission忙时只保留interactive，丢弃anticipatory；但真实短列表underfill恰使用anticipatory。优先级不等于欠账能否丢弃。
- Following纯resize只报告阅读观测，没有重判供给；Legend有几何重判，但忽略onUnderfill返回值。仅为Following接typed receipt仍不足以覆盖两个生产renderer。
- restore目标被保留只证明不丢身份，不证明同source新供给能唤醒该目标；必须独立守护目标推进。
- Admission baseline/bound revision不匹配的部分出口只有false/return；仍需证明这些出口不可达，或在该owner内定义明确的重新评价、取消或失败转移。

实现准入要求：同一消费义务协议覆盖Following、Legend、零行投影及显式target；供给、settlement、Admission解除及有效几何变化仅唤醒当前责任方重判，不无条件重派。filled、隐藏、撤权、activation替换都有确定退出。旧EOF/localEOF重复完成权威必须统一或删除。未满足这些条件不合候选，不用通过数量代替证明。
