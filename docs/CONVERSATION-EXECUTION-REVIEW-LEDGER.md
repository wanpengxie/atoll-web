# R3 执行与反证检查单

## Root 当前裁决覆盖层（2026-09-18，优先于下方历史状态）

### 最新状态（本段覆盖以下旧快照；监督周期已依用户改为20分钟）

#### 2026-09-19 00:14：前台调度抢占整合与候选边界

- 已合前序 `e5ce29f` 本地历史义务完成及 `057ce6d` 后台 source failure 向前台交接。本轮 root 亲读并整合调度抢占37行及两文件回归，主树93/93通过、diff-check通过。仅在真实 focused candidate 可派且容量满时取消一个离焦且无当前前台义务的批次；不改已dispatch priority/预算，不抢 user-demand/tail-refresh，已有取消释放时不再取消第二批，迟到数据拒写。不是扩大并发数，内存容量背压仍保守不抢。
- 整链诊断 `f5e9a23` 已交付，候选150定向/浏览器1/build通过，尚未整合；owner正将只读诊断hunks与调度业务联合冻结。包含原始wheel无scroll、当前blockedBy、全局槽位与各阶段，不能称共享页面已有该诊断。
- r4 a6b processing-save 独立正常包绑定81实际paint通过，外层slot保持、内层语义替换、共同正文位置不动。ordinary append仍红：长尾自动折叠3903→507导致native clamp、可见文本67–77行跳到1–6行，约3064px；0库writer不代表无跳动。整体不准入，main仍440c。
- Composer固定浮层候选尚未合，owner继续真实visual-only键盘边界及旧resize路径退役。EOF固定首item35px候选已交，独立审核prepend时slot迁移与测量身份。submission授权候选bbe1cdf正独审；compact closure候选已续独审，FeedCache跨实例候选仍待审。不能把交付报告当已上线。
- 20分钟durable闹铃已续；未改后端、部署或重启共享服务。

#### 2026-09-18 23:05：冷入口生命周期整合与真实未闭项

- `ea8e0da` live-tail 入场过渡已合：无新 scroll writer，当前 Following 同 DOM 布局过渡，非 live/cache/history/browsing 不重播。主树113定向/build通过；提交后独立正常440c解析 live-entry/reduced-motion/Q连续touch 3/3通过，接管残差0.53px。`629fde1` Q 首次有效 scroll 归 begin 的测试修正已合，未修改产品绕门。
- 本轮 root 亲读冷入口最终候选 product `1f913323b11e9a3c2d704e2dce6e07b6e28dc01180ae8228c37e825bc88e12bc` 全部11文件并整合，保留 ea8 live provenance import。整合主树6files201/201、build和diff-check通过；独立机制审准入，真实浏览器整合复核已派，不能以单测替代现场闭合。
- 冷入口机制：Reading 单一 activation attempt 统一恢复/历史请求，source 更换后旧 attempt 取消并交接同一 immutable obligation；Scheduler 管理排队/回执/页/commit 的有界失败与已授权网络 fallback，同source失败不自动循环；超时不是EOF。FeedCache旧写事务 abort+join 后才释放 fence，事务后本地Meta发布也校验epoch。
- 已知降级：如果浏览器 IDB 事务连 abort 都永久不结算，30秒 UI 明确报错、已连接网络可独立继续，但持久化 fence 故意保持锁；不宣称 Retry 可以修复浏览器数据库。用户 console 不能证明现场唯一根因。
- `3be322f6` 库候选仍拒绝整体合入：append actual-paint通过、fold几何通过但401未闭，processing-save Browsing真实3389→3003→3182两跳。首跳与旧row抽换/暂失焦同时，次跳与焦点恢复同时；原件未采writer/native max，不能当确定因果。实现和独立验证已重新启动继续追链；main依赖仍440c。
- 历史起点提示候选尚未合，正在核 Header 对 vendor prep anchor 的兼容以及 context identity，不能只凭标签滚走通过就准入。未部署、未重启共享服务、未改后端。

#### 2026-09-18 21:52：Q 输入接管实际整合

- 已亲审并整合 exact aca5 pure-Q union f8f8097523a8780c16e24e822347e37f52e07016009379182fc66199e99b36f3；独立机制审核 APPROVE。单一物理输入事务统一 wheel/touch/key，交接期间可见旧容器保留输入权，精确目标物化后原子切换；保留 D 编辑不切模式、冷 freshness 与 Outbox 实现。
- 当前主树整合后9个测试文件158/158通过，production build通过。候选独立真实输入4/4、相关D路径11/11通过；不把候选浏览器成绩冒充提交后重新执行。
- 仍未关闭：browsing append 的 -3396px 库写入、fold re-expand +3026.6px、processing save browsing -231px。库 owner 正追同一测量/锚定边界，不能随 Q 合入宣布关闭。processing save Following独立通过，Browsing失败保留。
- 未部署、未重启共享服务、未改后端。

#### 2026-09-18 21:31：本轮整合与独立反证

- `d5bfab3` 冷缓存优先权与取消生命周期已合，主树108定向通过；候选独立cold4/4、cached342.7ms。修因是未决cache selection时投机remote占唯一lane，安全Meta到后未接管；不是泛称Meta迟到。receipt/page取消均释放executor，焦点network不等待IDB。
- `4283cd5` 在Outbox事务get后、put前校验transmitting授权，关闭排队或await期间撤权仍写入transmitting的缺口。
- `aca5b0f` processing edit不再改变Reading mode，Composer在同编辑阶段可写后取得焦点。整合101定向/build通过；候选Following/Browsing实际201paints无白/双影，enter/cancel及普通草稿恢复通过。save/submit实际paint仍待独立核验，不泛化关闭。
- **b089+440c完整列表验收REJECT仍有效**：独立正常served模块绑定确认440c；browsing ordinary append库scrollBy -3396导致actualpaint跳旧history，fold re-expand控件位移3026.6px。Following D和prepend有效段通过不覆盖这两红。vendor owner已续派追首违约与875对照，未无证更换依赖。
- Q stage2独审机制准、pure-Q b089包160定向/4真实输入轨通过；尚未合。owner正在aca5b0f重放，必须保processing端口删除，不重带D。旧restore-rebase断言红与产品失败分开。
- FilesPanel/ArtifactsView上传未纳入Composer事务实现；记录覆盖范围缺口，不声称全部文件上传生命周期已关闭。

#### 2026-09-18 21:06：实际整合记录（覆盖以下历史状态）

- main `3dd456b` 已合通知冻结确认事件与冷加载 admission/page lease；主树183定向通过。独立正常浏览器通知4/4及Meta先于正文1/1通过：真实high-water 25→27，重载保持27，未来seq28先计数、呈现后才确认28；不是临时隐藏数字。
- 冷入口仍未整体关闭：3dd正式3/4，cached F7两次704/653ms超500ms，期间有反馈且最终内容完整。续查新样本683ms中cache Meta在点击前已就绪，旧频道foreground网络占槽、目标IDB延后；不能把不同样本都归因Meta迟到。cold owner继续机制诊断。
- `d3e797c` FeedCache事务提交后才发布内存Meta；`82fcaf1` D展示选择保持Reading模式，独立3条实际paint通过；`89ab18e` nested内容索引优化已合。
- `905c787` 交互请求事务已亲审合入，保留D窄编辑入口及通知接线；8 suites58 tests/build通过，独立整合App复核已续派。编辑释放固定2秒重试无退避、进程终止无后台保证仍为已知限制。
- 440c正式流保留修复已进入本工作树：源码只保留同key/index/context的connected formal节点，未加initial取消或第二writer。安装首次未替换旧875，旧包上的132绿已明确不算新包结果；随后保留旧目录到`/tmp/atoll-vendor-before-440c-epaFzS`并正常npm重装，实核ESM440c，重新132/132与build通过。实际浏览器整合门待独立执行。
- Q stage2未合：mouse/touch旧机制oracle红不能直接算产品失败，keyboard占位几何早发命令已在候选修复；独立源审与实际paint仍在进行。processing edit闪烁独立续派，不随D通过关闭。
- 未部署、未重启服务，未修改后端。不得将上述局部结果拼成整体验收。

#### 20分钟监督更新：d450400 后候选与独立复核裁决

- 已提交快照为 `d450400`；875 正常 installed 解析 startup/continuous 已有有界通过。以下工作树候选尚不能拼成完整交付。
- Waiting 去 matched closure 候选拒绝合入：独立审计用真实 Scheduler 复现“旧页在途→live matched terminal→trim→旧页释放”恢复 queued。当前共享 `memory-window.js` 保留 compact closure，root已亲读确认。实现者续补永久反例和安全生命周期分析，不以999绿代替该反例。
- 通知分类175定向/F7 8轨通过；inactive频道 reload 时 IDB正文存在但 Replica 空，真实 final badge 1→0仍开。通知owner已获 feed-cache/useChannelFeed 最小相关区段施工权，不能只恢复48行或忽略父request。
- 输入r9为7高度目标/7原writer，逐帧约5px，98定向/build通过；旧35writer动画候选不签。接续发送脱尾：d450 formal extent瞬减228引发native clamp，恢复高度后留下gap，已有因果原件，owner继续核当前版本并修，禁止第二writer兜底。
- 撤回上一轮将旧 +329 归为当前失败：clean d450 A→B→A repeat8通过，旧artifact库绑定不同。fixed48按用户取舍有界通过，不恢复已取消的展开无遮挡门。
- 历史缓存优化同轨最大长任务357→144ms；冷首显raw738ms仍慢，数据先到、React/list协调为后续诊断方向，不能声称冷性能已修。
- 完整审计38需求行已完成历史证据归档；后续行为核验与4路修复并行。所有结果必须标明基线/候选，旧报告留作历史，不作为当前完成声明。

#### 当前：875已workspace接入，正常installed解析门正在执行

- root实核installed ESM `87560b6dc8dbfda5b88b2df457ca2bf735a0e58c97da7e0635a1c3f828620742`、Legend `10260969385a4877c30d31bee97aec2ffc8bc77394094f662564e1681bbe0f5c`；npm/pnpm锁同步，990全测/build据实现通过，未部署/重启/提交。
- 9031591c报告通过的是alias候选+精确真实接线：startup tail120/gap1，continuous108paint无白、gap0/following。不是正常installed解析验收。root发现verify已completed后主动followup该最终门，禁止把二者混签。
- review并行查tail已可见仍显示“正在确认频道内容”的实际状态链，不能仅隐藏文案。当前未宣布整个产品交付。

#### 当前纠正：initial row120拒绝来自测试输入错误，撤回

- 875真实App接线已无Maximum-depth；此前以multi-channel默认3条历史却断言row120，测试无效，不能声称初始定位故障。193安全撤接线相同row120结论亦撤回，真实崩溃证据不撤。
- root已亲读875报告顶部INVALID更正；review同步核实际seed/tail oracle。有效deep-history复验已报告row120出现、可见115–120且React错误0，待verify物理gap/完整current-App continuous原件；504基础设施记录单列不冒充产品失败。
- 没有因此修改initial机制。新候选875仍冻结，最终真实接线矩阵完成后才替换workspace193与恢复feedback。禁止输入错误推动无效补丁。

#### 当前：安全撤接线已止崩，但初始位置错误；重复准备循环仍施工

- 独立安全撤接线验证：timeline存在、React错误消失；但落history1而不是预期尾部row120，故不是完整启动通过。
- exact193真实形状最小反例：formal feedback配initial触发新准备generation循环，App同tuple去重无效。3b0同source request guard仍不足；后续输入二分还发现等值initial对象重复发布及measurement callback重发入口。不同候选/输入不能混称唯一根因，已要求review归档逐case完整props与hash矩阵、撤回过度结论。
- 新冻结须先通过原Chromium反例，再验证真实App接线启动/初始LAST/continuous；verify已续派，不提前替换workspace候选。当前官方服务未重启/部署，候选依赖仍193且formal反馈安全断开。

#### 当前：193候选矩阵通过，但实际workspace接线启动崩溃，集成拒绝

- exact193候选完整请求矩阵通过；随后已将tgz、npm/pnpm锁及新props接入workspace，不能再称生产源码完全未动。未部署或重启运行服务。
- 真实App登录触发Maximum update depth并卸载timeline。App同tuple去重后仍失败；root亲读08b81报告，撤回静态‘去重闭环已消失’签署。栈落在库zero-candidate formal transition同步external-store发布，不能臆测tuple alternation。
- 已要求impl优先最小安全撤本次新接线并验证可启动，保存patch、不覆盖其他改动；review独立审真实App与隔离输入差异及发布幂等性；verify以React捕获错误和timeline存在验启动，不让pageerror空数组冒充通过。根修仍在隔离库，不加App条件掩盖。

#### 当前：193454f2 稳定observer候选，最终current-App矩阵进行中

- RO实例诊断后改为同host稳定原生observer；callback版本仅更新配置并使旧queued工作失效，有未处理观察时安排一次fresh读取，避免丢测。237通过/4跳过，双build一致。不是沿用827 prime条件。
- exact193 public重复3次与原生RO生命周期门通过；观察器同host不再revision重绑；4101/4105首段通过。App key/status/promotion/fold单次+重复3次均绿。
- 一次continuous误用旧Legend87de/skipRAF fixture已标INVALID，不作候选失败或通过；verify使用current Legend3080明确绑定重跑。late/width报告待总报告核实，不提前合签。
- exact193 tgz已离线重建，SHA `1c60d0465750057b62618b844f0ea8c294083bf90b3e185f23de3b0a8de7a271`；root已读MANIFEST。review并行隔离App最小接线patch，待最终门准入后推进workspace整合。生产依赖未换。

#### 当前：a316扩展门RO错误未闭；827尝试无效已拒

- a316同hash隔离App key/status/promotion/fold通过；4101/4105无白、公开target三次位置与接管正确，但每轨一次RO loop error，整体拒绝。原三门通过保留，不代表全签。
- 827以zero-diff RO才允许samePaint的尝试，public重复3次仍各一次probe前40–53ms RO错误；root已亲读报告。不能从startup时段直接推出具体observer来源，该修法不准入。
- verifier续一次原生RO实例/创建栈/目标/entry/回调前后几何诊断，保持原动作与错误；impl只读列List/prep/retained/viewport及fixture的反馈路径，取得实例证据再改，不继续加prime条件。生产未替依赖。集成包已准备，待此实际错误闭合。

#### 当前裁决：a3164908 三个实际浏览器门通过，必要原历史门续验

- root已亲读 `audit-output/history-independent-flow-context-a3164908-15783/VERDICT.md`。exact a316 continuous：76 compositor帧无白，接管239帧无空/语义位移；返底总高19948/19949不再短缩471，gap0/following，仅prepend一次+1397，quiet无新writer/error。
- 同cut late-growth：唯一+180写入先于首renderer Paint 10.305ms，后续残差0；width变化同root/list、焦点与selection保持，正式行持续可读，准备行hidden/inert。
- 修复不变量：正式行不能在对应spacer接替前被准备token移出normal flow；当前formal豁免保留connected及same-context校验；live certificate统一itemSize标尺。逐commit守恒回归旧6503红、新cut绿。旧observer解释bottom已撤，不再沿用。
- verifier已续exact a316原4101/4105与公开target/native接管；review并行隔离App key/status/promotion/fold；impl并行可复现依赖集成包。不得用旧hash代签；没有新增泛库硬门。生产依赖尚未替换、未部署。

#### 当前裁决：65030216 仍拒绝准入

- 0c5单次诊断已证 range commit 瞬时缩短 scrollHeight（13614→12217），触发 native clamp；返底期间无库反向 writer，App snapshot/40行不回退。此前将它进一步归为旧 observer closure 的结论属于不充分推断，现撤回。
- 65030216 仅修 observer generation 和同host准备缓存失效，235通过/4跳过、双build一致；独立原continuous仍 gap471，RO错误本轮为0。因此 observer 修复不能宣称关闭返底问题，也不能将旧候选具体瞬态直接当新候选证据。
- verify续同轨6503诊断并在失败前保存tuple/style/range/writer；review和impl并行查正式rows、retained、上下spacer、margin/deviation的高度守恒及快照来源。没有新因果证据前不再出猜测修法。late/width未跑，生产依赖未换。

#### 当前裁决：0c5fd9fc 未准入（2026-09-18 09时段）

- 0501 的 late-growth 已以 renderer Paint/Commit/Display 时序验证：唯一 +180 写入先于首 Paint 8.810ms；旧 9c8d 阳性对照能捕获写入前错误 Display。不能再用 pre-RO rAF 位移直接判可见跳动。width 门通过，但连续滚动出现 RO 反馈错误、返底失败，因此整体拒绝。
- 新 0c5fd9fc（完整 SHA `0c5fd9fc28ceec32d71ca3c6f2ea24fe41d96eff1db395905c7cefcf9413fd3c`）233 unit 通过、4 跳过；隔离 App 的宽度为零反馈、measurement key、promotion、fold 门通过，businessWrites=0、runtimeErrors=[]。
- 同一候选独立 continuous **失败**：2 次 RO 错误，120 次返底 wheel 全部执行仍 gap=471px，之后约9.2秒恒定。错误在 input-ended/return-bottom 同秒，不是启动错误，也不是先到底后 extent 新增。现有证据不能断言 RO 与 gap 同因。
- root 已亲读独立报告；review/verify 共享一次原轨诊断，补实际 wheel 命中 host、完整 scroll tuple、末行几何、所有 writer 与 Reading 状态，失败亦保存。impl 冻结源码并核同步 RO 更新路径，不预先指定新修法。late/width/4101/4105 未在 0c5 重跑，不继承旧候选通过。
- 生产依赖仍未替换。以下各旧快照只作历史证据，不代表当前完成状态。监督仍为20分钟，关键反例即时处理。

#### 闪白专项最新覆盖（2026-09-18，7f65独立复核后）

- d4aa独立两门结果：width/focus/selection/paint通过，connected late-growth仍红（180px、settled157px）；started→ended无layout commit已定位，新commit revision仅诊断待验证，不继承旧主路径通过。
- 独立发现准备缓存循环（12行亦可复现）；实现已调整desired/initial DOM与offscreen extent证书层级，尚待新freeze。新增反馈API的ready与cold duplicate failure单例确定红，先闭这些入口，不允许静默pending当完成。
- 实现Agent容量失败已同Sol重启；verify续单late门，review续状态单例/隔离App接线，源码仍implementation唯一写入。没有新生产依赖接入。

- 后续范围实证：55c7同host宽度导致正式行清空/真实白屏/textarea失焦；prep中row39晚增180令row40持续+180。root已读GEOMETRY-COUNTEREXAMPLES，不能泛化旧bounded PASS。
- d4aa生命周期cut已冻结，227通过/4跳过；正式RO常绑、live宽度原地处理、DOM绑定证书/跨批节点保护/retained失效监听与逐行measurement key。独立verify正在同两红复核，尚未准入。
- App逐行签名兼容修正27通过/build；review续做隔离候选接线，官方依赖未接新prop。impl下一cut补准备状态端口，ready须formal DOM commit；不引入轮询，已有可见行不遮挡、前台无内容才提示。

- 最新55c7 **bounded PASS** 已由root读VERDICT：当前App3080+实际served55c7绑定连续轨22paint可读，gap0/following、window/RO错误0；4101/4105、公开target3次、prepend33/65、append7、同key换data撤权对应轨通过。仅本矩阵，不是完整交付或已部署。
- 本App实际几何边界仍开，root读源码确认prep期间callbackRef(null)暂停正式List RO；width变化时active可被formalPreparing隐藏，render期还读computedStyle。impl续派同一生命周期修复及跨批目标DOM保护；verify独立同host focus/selection及prep时late-media反例；review核rowRenderRevision签名实际接线和准备effect/反馈。三路已重新启动，不扩通用variant/无据性能硬门。

- 最新监督：App bottom修复已实际落adapter `3080eb17`，新增红4→绿、定向55/55与build；root已读source/settled分轴和三重身份检查。55c7独立已有33/65分批、append7、公开target与历史轨迹局部证据，仍等完整同源签署。
- fresh App出现+613后反向-613的产物已撤为 **INVALID candidate binding**：测试共享node_modules/.vite复用了原版预构建，不是55c7。保留反证；不得据此改候选。verify重建独立缓存，要求实际served模块URL/hash绑定再复跑。
- 已要求review继续只读核本App接入契约（data immutable、renderer变化、Item/List属性与ref转发、等待反馈），不把通用库未支持variant当产品阻塞。55c7 SUPPORT明确全extent测量代价与无RO/不转发ref限制，未宣称全产品完成。

- 后续20分钟检查：55c7已冻结（dist SHA `55c7c0f10bdd8561292a724c227c1485a695ddc6625118276d68f2ad7484d6f9`），全库226通过/4跳过、typecheck/lint/build通过；独立浏览器尚待，不继承7f65成绩。accepted-source半更新duplicate根因已修同代recalc完成后发布，标准vertical完整extent走分批实测后准入。
- 7f65公开handle.scrollToIndex(137,start)与随后真实wheel接管，独立单次+3重复通过；旧估高raw2500 oracle不再误当目标语义。原整体REJECT仍保留。
- root亲读App源码确认bottom断点：scrollend的settled覆盖同帧pending user；review转施工独占adapter，以因果source与settled阶段分离，保留selection/layout/epoch权限边界。库不为App观察合并错误加补偿。
- RO旧7f65冻结App有skipRAF而当前App已去掉，现有warning只证初始化一次，精确observer尚未定；fresh current-App验证单列，不凭旧warning改库。impl冻结后继续只读限制/接入审查，verify独立55c7，三路不串行等待。

- 用户已要求仅 Sol high，Astra停止；implementation、独立review、browser verification三路，生产依赖未替换。
- 撤回15903的“1485降为360即修复”判断：shared-row median在零共享可见行时漏判，实际paint跨段；保留 `audit-output/formal-gate-continuous-15903/INDEPENDENT-REVIEW.md` 反证。
- 后续冻结7f65由独立验证确认continuous/4101/4105对应提交边界无白、可见语义与DOM身份保持，extent与唯一writer等量。不是沿用15903指标；原件在channel根 `audit-output/history-independent-formalgate-15783/{VERDICT,MANIFEST}.md`。
- 7f65仍REJECT：物理bottom gap0后83帧browsing；各轨初始RO loop；公开handle.scrollToIndex未覆盖，启动401另需辨明fixture来源，不混作已证组件根因。
- 新树继续统一requested/accepted data/totalCount/first与extent，已出现duplicate-key fail-closed空帧，未冻结未准入。需查原子发布/权限数据映射，不以隐藏报错通过。
- 当前分工：impl负责统一准入；review只读诊断bottom完整链；verify补公开定位与native接管，先以15903反例校验可见语义oracle。rawscrollTop2500无需保持旧估高row13，但显式目标、无迟到跳和真实bottom仍必须成立。
- timer已恢复成功；此前下方“续设失败”属于旧快照。20分钟持久闹铃逐次检查、续设，不前台轮询。

#### 当前交付面板（root维护；不是发布通过声明）

| 交付范围 | 当前证据与状态 | 剩余动作 / owner |
|---|---|---|
| 历史准入与滚动连续性 | 隔离e356 stationary保持原paint；4101普通估高首测+1830错位，未准入生产 | Astra完成普通测量路径；architecture独立审，browser同hash验证 |
| 顶部Loading平滑下展 | 稀疏跨批供给/反馈已修；仅原生wheel进入原型5轨通过，不等于主动下展完成 | loading实现用户抵边等待后的单owner主动reveal原型 |
| 发送 / 跟随 / 输入接管 | 单行、多行发送已有具名通过；普通测量+47迟到修正仍影响真实体验 | 归入同一组件测量修复；最终真实App发送复核 |
| Waiting事实与操作权限 | canonical/终态归一、当前roster动作门35项通过 | 整合browser覆盖，不能仅unit宣告整体完成 |
| Waiting布局 | 用户选择fixed48，严格3轨313帧/700命中通过 | 当前整合轨重验；展开超出48是已记录取舍，不复活动态margin |
| 通知完整链 | FINAL分类、exact ack、持久authority、旧producer/owner门定向与F7通过 | 当前整合browser；原用户18/20没有逐项现场样本，不声称已逐项解释 |
| 冷进入 / Meta / 刷新到底 | 冷4轨、session10unit/App1；正式构建10次无假空/卡住，134–455ms波动 | 当前整合browser；不以dev开销新增调参施工 |
| 权限 / 过滤 / 频道切换 | generation/forbidden/filtered-read定向通过；deleted-anchor正确前置后两轮8/8 | 迟到测量漂移另保留，当前整合权限旅程复核 |
| 内容 / 折叠 / 表格 / 选择 | 具名内容、表格、selection轨有绑定快照通过 | 新整合snapshot复核；不拿旧像素阈值扩大需求 |
| React提交 / 草稿 / 附件 / 编辑 | Presentation/Role、Reading、附件、initial位置已修；编辑整个context→replace→unhold事务仍收口 | UX施工，submission独立审；不得把中间hash当最终 |
| 移动端与性能 | 移动模拟旧轨有结果，真实设备未核；正式冷首屏证据已收 | 整合mobile模拟明确范围，真机不冒充通过 |
| 文档与整体验收 | 当前架构索引已落；冻结188版本134文件960unit/build通过 | 当前browser独立快照进行；组件候选准入后仍须最终同源验收 |

运行附项：root最新实查5173 PID2853198正在监听，本机及公网均200；原退出原因仍未知，不能声称由本轮root重启。timer工具再次在宿主turn归属校验处失败，20分钟续设尚未成功；本地goal续工仍在进行。

#### 最新监督校准（覆盖本标题以下全部旧状态）

- 整合97def单轮已结束：日志202 passed、1 skipped，其余失败待integrity完整分类表，不将后续修复冒充此轮结果。root已要求先完成定向/组件准入，非机械重跑全套。
- root复读Reading最新rejection已改为同ownsHistoryOperation谓词，补generation/exact promise对称门；定向50unit后browser签署中。phase-d helper整组8绿；一次effect deps警告已按mtime与前后数组对应并发useSubmissions HMR，非固定源码动态数组，不另建无据生产债。
- #26 waiting trusted wheel后的库+47：writer非零不是故障充分条件，但旧证据必要补偿晚于paint仍有真跳，保持连续性未闭，不直接归false-red。Astra新trusted-input同步measure门还须核keyboard/scrollbar和samehost再次程序定位边界，root已派独立审核，不只避初始fixture。

- 冷/EOF当前0c3b已去函数引用身份误判、oldest真实1/1不再新增空转；root又读出rejection分支缺generation/exact-promise，已要求同owner谓词防旧代错误污染。该版本仍施工不称最终freeze。
- sparse Loading误归因已纠正：epoch1约40物理页status-1不变；13节点来自EOF后12次错误新operation，不是每物理页卸载。loading_owner先复验EOF修，不盲增Timeline状态机；pending→权威EOF一次状态交接与同等待动画中断必须区分。
- sync逐trace确认phase-d按钮仅一次合法自动消失，此后无重复detached，helper isVisible→click竞态，已批准测试只在按钮确实自动消失时接受，不force/不吞真实不稳。root亲看VIS09三图差异仅新增权威EOF pill，待fixture权威核后按新设计更新单baseline。
- 同document返回真跳已有逐paint：首次目标107可见top228.3后下一帧top-100.7/scroll+329，不是精确offset偏差。list_owner已恢复专门追首次可见→额外写链，禁止新补偿循环。7a6f独立反证初始错误/非零prep卡住已收，Astra源码定位callback-ref重绑null使child effect失去RO，准备稳定native ref修。

- 发送提前写已落adapter940a2d：只阻pending send生成伪follow-ready height，保真实geometry义务；root亲读实现与REVIEW，100unit/真实browsing1/Waiting4通过，首写前目标DOM/durable已存在、gap0、wheel后无写。共享树定向证据不是最终immutable全验收，原97def早写红不回写。
- 7a6f独立4101首观察不仅白帧：initial row10而非原row13，30prep未释放且extent不增长，当前不签供给完成；Astra已拿第一分歧继续源码追踪。动画接口保持独立设计，禁止在prep卡点尚未闭时掺新状态机。
- unavailable源码合同核清：member可编辑/本地队列、transport暂停，forbidden/retired另禁。root亲读useSubmissions发现wire unavailable错误转rejected及retired残留member可durable，已派submission_owner实施exact状态修正，保持草稿/稳定ID/无自激。phase-b旧disabled断言据此更新但不掩盖新查缺口。
- 新动态按钮反复detached由sync_audit独立追DOM时序，不force click；长文11字符是短heading有效选择，已批准真实拖拽/clipboard语义oracle取代任意>20门，保原件。内存恢复329.8差先核是否首paint后大跳，不重新引入已取消≤2px精确恢复门。

- 组件7a6f新冻结全220pass/4skip，已交独立4101/4105/initial与fold轨，不继承旧paint结果；readonly review又确认同host数据撤销后retained cache可留旧正文≤64条，跨频道key有隔离但同频道projection无隔离。root亲读cache复制/逐出逻辑，已交Astra修权威集合撤销，7a6f仅诊断不生产。
- 平滑handoff原型升级为显式measured+committed信号，8轨/24重复、26reveal帧同anchor DOM连续；连续第二批不重播、measurement revision撤owner、reduced单写<20ms。root亲读HANDOFF，要求真实库内writer互斥/撤销时点，不能把黑盒signal或两帧stable当生产接口已完成。
- oversized测试修已独立通过：首次104折叠控制和507px几何实证，另验3次非空准入/19paint/0空；原fullrun假红保留。continuous真实+613后迟到反向补偿未关闭。整合phase-b断线disabled旧oracle按离线编辑durable合同修；权威unavailable与forbidden/retired区别由submission_owner源码审，不盲改禁用。

- Composer窄屏上传触点已实际修：responsive d3fa9dbd仅为mobile-shell两工具提供44×44；root亲读CSS与键盘/无溢出/阅读区几何测试，完整f2 5/5、responsive1/1、56unit/build。未改Composer或Timeline，不依赖组件专项。
- send_order_review独立确认browsing→following让follow-ready以旧extent铸height token，目标未入Waiting/正文就提前写；不是Waiting同revision本身错误。已准adapter唯一owner修token来源，保留真实viewport、晚媒体、presentation独立义务，不一概禁pending send的所有geometry。
- oldest重复空转确证exhausted结果先于React hasOlder提交导致未记EOF，cold_channel承接；Home输入已发生而request未启动，精确early-return尚在核。ux_frontend更新channel/scope/access旧持久化oracle但必须继续真实同document恢复，不能删断言即宣布通过。100k/perf额外旧bookmark门与selection11字符分别只读分类，不恢复用户取消的像素/100k硬门。

- 本轮进一步分类：cold首显红确证267–268ms首16行已staged，269ms请求结算后270ms下一operation覆盖未commit事务；cold_channel独占Reading修live admission门并核取消/续供给。原“oversized目标未安装”已被原trace反证：目标104实际出现4帧，测试循环覆写extremeInstalled且强求同时>=3批导致错过，history_product_failures已承接修测试动作状态机，不掩盖continuity真实红。channel/scope/access三条localStorage bookmark=null属于旧持久化oracle，用户明确仅内存恢复，ux_frontend核真实同document体验，禁止恢复旧持久化。
- 当前并行新增send_order_review只读核snapshotRevision与发送destination合同；history_product_failures核供给与连续跳动；fold_owner已原版独立复现合法clamp4621→3065后库再-1733，订阅Astra新cut验证而非另加应用补偿。history_transition_finish已隔离6轨/重复18通过，尚需逐帧、异步尺寸与同owner接口审核，未生产接入。

- 整合browser已实际运行：不可变快照97defea7，52文件231项，独占45231/48931，非真实服务。已出现至少六项红：prepared首显1245.9ms；上传触点32px；显式折叠后目标行退出物化窗口；oversized历史目标未安装；browsing发送定位早于目标presentation；连续上滑历史反向跳。原件逐项保留，不拿旧定向绿覆盖。cold_channel与fold_owner已followup恢复实际分析；edit_transaction_finish承接上传触点；history_product_failures独立核历史供给/跳动。没有活跃list_owner/loading_owner，发给旧名字不算任务已承接。
- 编辑候选Timeline615fe3bd已完成context/replace/unhold同commit权威，19编辑/133相关/build通过；root亲读release选择最新同频道turn与原hold callback，仍需独立审及最终整合，当前browser旧8ab不覆盖该完成稿。
- Astra新b68虽报告217pass/4skip与构建通过，随后主动发现retained隐藏行fixed top0可污染rect可见筛选，已撤验收候选、正在修。独立component_review须按冻结hash逐项核旧发现，不把不同版本结果混用。生产依赖未替换。
- 折叠首因果已读轨：正常收缩clamp后库再次滚动并回收目标，应用未获writer授权。root禁止未经机制对齐就加应用FoldAnchorTxn/两次ack恢复，要求与Astra普通测量owner协同，区分合法clamp和额外位移。

- 执行队列实际变更：本轮list_agents仅root running、flicker_astra/test_integrity pending_init，旧其他worker不再在目录。root已通知两者恢复磁盘任务，并新建edit_transaction_finish（Timeline编辑收口）、history_transition_finish（主动下展隔离原型）、component_review_finish（组件只读独立审核）。不得继承旧“全部running”叙述；文件/证据保留，不重做已有通过工作。

- 闹铃入口故障已源码定位（只读）：atoll/drivers/agents/provider/codex/worker.go:568–575在工具分派前校验connection/phase/thread/native turn；不匹配统一返回outside active turn。因此本轮timer list/set请求未到timer业务层，不能声称续设或改timer参数可修。未改后端/绕过该归属校验；本地工作与goal续工继续。

- 第二独立整合快照 `8b4670b4` 已完整134文件/960测试全通过，build通过，root亲读SUMMARY及五关键hash；这是Timeline188快照的unit/build，不覆盖browser或隔离组件。随后Timeline fe213增加原edit callback保持门，59定向通过、静审中，不能冒称960覆盖新hash。
- root审核当前架构文档发现“唯一scroll writer”未区分应用和库，已要求改正文：生产应用有唯一授权入口，但Virtuoso仍有自己的initial/prepend/upward物理写路径，当前组件专项正修此边界，不能将目标结构写成已实现事实。

- 平滑交互约束纠正：root此前一概禁止主scroll动画，和用户明确要求“顶端Loading后内容缓缓向下进入”冲突，已撤销该过度约束。loading隔离实现A：仅用户已抵边等待且当前activation/input仍有效，由同一几何owner按实测内容做有界主动reveal；后台warm/普通阅读不移动，新trusted input即时接管，reduced-motion直接终态，不overlay/第二writer。不是整页4995px自动卷过用户。旧native-wheel原型5绿仅证明稳定准入，不能替代主动过渡。
- deleted-anchor测试前置修复已pair2/2、整组8/8两次，Reading0c998/Legendf1c512同源；原真实迟到漂移单列继续处理，不因测试绿关闭。

- 整组deleted-anchor超时已拆开：测试定位a60返回后，切换前真实位置迟到漂至a74，却仍删a60等待a61，测试前置不成立。cold修有界driver与切换前硬断言；a60→a74的生产迟到漂移仍保留原件交Astra，不能随测试修复关闭普通测量问题。
- integrity已最小更新4类旧fixture，4文件74项通过，不改生产/全局mock/锁；原冻结12/946结果不重写。最终同源全量仍待本轮owner收口后运行。

- 4101首错细化：不是已证明的“同一节点重挂”。action-start row0..11仍按12×132=1584 spacer；本capture首次挂载实际3414，差1830，首paint错位前没有同ID重新add证据。故当前准确名称为普通range首次实测替换估高空间；Astra须统一处理，不能仅开启历史之后的DOM缓存。history在错位后才请求。
- Reading最终增补旧generation Promise exhaustion门 `0c998c5d` 已36/89定向与静审通过，root读exact controller/activation/channel/view/requestPort/generation/promise条件。cold/F7原12轨证据保留；生命周期整组超时仍由cold独立核。

- e356完整4101仍红，root已读原件并确认与4105不矛盾：第一次native -700后row13应到+354，paint却row8/9，发生在history请求之前；后续实测+13434只保持当时位置。已由Astra继续普通行首次测量/回收路径，browser从原trace区分从未测量与重挂变化，不再以prefix样本冒充全链完成。
- Reading `6faf2cea` 提交owner已落，root读insertion仅私有refs发布、旧DOM closure exact-owner拒绝；35 Reading/88通知/12 cold+F7/build通过。生命周期deleted-long-anchor单跑绿而整组超时未关闭，cold owner独立追查，不能称8/8。

- e356首个独立4105已通过且root亲读证据/查看paint：同row-0 serial6/top0，准入前后paint字节一致；唯一+13434恰等真实extent差，无白/错内容。仅隔离stationary样本，4101普通remount轨正在同hash验证，不称完整修复。Loading owner已恢复基于真实准入的隔离过渡施工，不再停在旧估高原型报告。
- History审计校准已由root读两端源码：Gateway history.go明确完成root只保terminal，turn-process.js却将更早stage:text当参与者正文保留。机械progress省略符合用户要求，不是缺口；真正stage:text的fresh-history保真存在来源合同差异。前端不能补造被源省略的正文，本轮不改后端或新增全账查询；单独记录待授权合同事项，不妨碍其他前端工作。
- 附件App `1d17da45` 101定向/build及独立静审通过；root亲读每await后principal/world/clear epoch门与原频道ledger合并。initialLocation render消费已由list owner修为layout commit，真实Suspense反例、52定向/build通过，root已读新guard；不增加滚动writer。

- 新实物：Astra实测准入构建 `e356850e` 已交独立browser；typecheck/build、库215测试通过4skip。每32个真实同宽DOM测后准入，尚无本轮browser结论；准备commit误触App定位、普通remount与近期DOM保留仍未闭，不替换生产依赖。
- Presentation/Role纯candidate→layout commit已修真实Suspense反例，58定向/App1/build及独立静审通过；UX继续Timeline editing/readingControl提交边界。list owner已恢复检查initialLocation渲染期消费，sync处理Reading observer提交权威，submission处理附件异步身份。
- 独立冻结完整Vitest基线12失败/946、build通过：2项为当时真实Presentation污染（后续已修）；其余10项逐项确认为过时authority/history接口/可见确认fixture，integrity已承接更新，不改业务断言、不冒充当前全绿。
- 删除非需求硬门：semantic text-point消费者和像素恢复不是缺口。历史源stage:text与机械process须按旧语义独立核实，不能自行扩大后端修改范围。fixed48保留用户简化取舍；展开范围不以collapsed测试冒充全面不遮挡。
- 本轮系统timer接口返回 `tool call outside the active turn`，list及describe均失败；未声称已续设。已有df762定时器是否仍pending本轮无法确认，任务施工继续。

- 夜间继续交付：用户已要求自主完成整项，20分钟后台检查。Astra新路线已新增measuredHistoryAdmission模型和测试，renderer/sizeTree尚在接线，无新browser结果；旧7f/d40结果不继承。root亲读32行分片/重建token实现，已交Astra核stream重置饥饿、早片尺寸过时及failed preparation可重试边界。不是以root推断直接指定修法。
- 已补派当前确定缺口：UX负责Presentation/Role render purity，真实Suspense两反例已红；sync负责Reading候选ref与已提交observer边界；submission负责附件跨await候选mirror；performance独立读cold trace优化真实瓶颈；test_integrity独立快照完整unit/build建立诊断基线；design重新核用户已取消的像素/恢复硬门及history单位/固定留白语义。
- cold完整状态表达：Meta未清，fresh双提示与零行假partial空态两缺口已修，89unit/browser4/build通过；cached可读364ms/prepared466ms，75–85ms长任务仍明确未闭。ViewSession刷新到底10unit/App1完成。
- 通知完整模型当前85unit/F7 8browser/build通过，已修晚空IDB boot撤销remote read authority，arrival durable disposition/身份schema/exact-seq保留；不宣称用户原18/20逐项样本已取得。App producer token在Replica/access/cache/通知前拒旧世界，97unit/build+静审通过；附件P1单列。

- 闪白唯一实现owner为flicker_astra，architecture只读、browser独立。futureTop方案已否决删除；最新d40固定已测窗口4105画面连续但unsafe-release安全错误，拒绝准入。全subset是实验充分条件而非产品必要条件，Astra独立评估分batch交接与收敛，不得仅删error称绿；尚未替换生产依赖。
- generic +47旧“无必要补偿”归因已撤：pre-wheel内容位置+native delta算出的目标证明+47有必要，错误是晚paint二跳。不能用writer计数=0作为正确性。普通路径与prepend claim互斥，尚未实施关闭。
- Scheduler current-tail供给e7cc：cache/remote frontier与在途pageEnd head前移两反例已修，45unit/权限repeat3/延迟3/build通过；旧LAST token实验撤回，非列表定位故障。
- 阅读位置生命周期：view-session跨document强制following/null bookmark，只保留同document内存位置；10unit/browser1/build同源通过，刷新含IDB缓存仍真正到尾。无TTL、后台不自动清内存。
- Admission render purity5c4688/Timeline6ee7ab：evaluate纯读、layout commitCandidate唯一发布；17模型React/60相关/App1通过。Presentation.project与RoleFinalizer等其他render owner仍在独立审核，不把该项扩为全链完成。
- 通知FINAL分类与exact high-water已有定向证据，但用户rail18/20未关闭。用户明确不等其样本：sync继续全链classification/ack/boot-world persistence/arrival disposition，诊断不是完成。真实payload未知，不能擅禁所有response/tool/空final。
- fixed48严格313frames/700hit/3browser通过；Waiting roster35unit/build通过。展开Waiting高于reserve的遮挡语义为新审计风险，须尊重用户固定collapsed reserve取舍，不擅重启动态margin方案。
- Composer/AppShell/useSubmissions commit ports专项通过；App旧producer在新principal commit后迟到的source-token门仍施工，与sync共享feed需协调，不称整链完成。
- 平滑历史过渡旧两个原型失败、fixed132候选已停；依赖列表正确空间交接，但不允许以动画掩盖白帧或新增滚动writer。整体源码/设备/集成验收仍未完成。

#### 以下为前轮快照，仅作追溯

- Fixed48当前不可变快照3/3、304帧恒48、692次控件命中无失败，unit/build通过；不再保留动态Waiting空间候选为当前阻塞。
- Waiting roster动作门35定向/build完成；canonical queued保留，caller cancel与receiver权限分开。filtered physical read116定向/build完成。
- 通知新回归：rail用非PROVISIONAL黑名单，误计业务progress/unknown；arrival使用FINAL白名单。sync正在统一为明确FINAL准入，保留真正回答，不采用所有response禁通知。
- Admission r4修render期跨组件发布，56定向/App1通过；12页观察合并一次prepend、反向取消无stale。空间平滑动画及4101仍未关闭。
- Send当前不可变快照single/multiline通过；trusted wheel后库scrollBy47失败，2/3不能报3/3。list负责追补偿分支与实际可见位移。
- Initial-tail新activation一次公开LAST token已实施46unit/permission首轮1通过，重复验证运行中；不算关闭。
- 闪白candidate6隔离源码已编译/typecheck、80测试通过（4 skip），dist f3a9fe80158f72cb13bfc71762351daceeb7ace380604fe821c7825c1faaee86。root核diff349新增/14删除；browser已获路径接initial负控和4101。candidate4错内容、candidate5误拦initial均拒；未改生产依赖，没有可宣告的闪白修复结果。
- 冷首屏、表格/selection、默认角色折叠、scope/timer、权限撤销各有定向证据；不能代替当前同源全量验收。真实移动设备仍未验；长文性能仍有风险，不以自加像素/100k阈值阻塞用户核心体验。

- 最新关闭：filtered-read实现与代码审核通过。root亲核projectTimeline仅mine应用actorFilter，all忽略stored Set，因此receipt all effective filter0正确；architecture撤回误判阻断。116定向/build证据对应，最终全App集成不冒充本项仍待审核。
- Admission r3已生产整合：14次physical observe→一次exact3/purePrepend/DOM4→7，反向取消0 stale commit/0 Admission writer；25模型及真实App1/1同源。仅关闭多批一次展示，不关闭4101/空间动画。
- Waiting权限：App principal/channel/feed generation+complete roster→AppShell→Timeline已接，caller cancel与receiver controls拆分，unknown/departed保留canonical queued。30定向通过，接线/宽测试/build执行中，无等待依赖。
- 闪白最新隔离candidate4去白错内容拒绝；candidate5误门控initial/显式定位阶段拒绝。尚未生产替换依赖。当前缺的是正确prepend measurement ownership生命周期及anchor目标事务，不再以参数试验替代原理。
- 当前初始化回归修正：0bf在新activation首次ready提前执行follow writer，先把部分历史窗口当尾部，119已到但DOM停103–110；23e14改新activation只登记授权，已有同activation边沿才发义务。owner原失败场1/1、jump1/1、71unit；loading当前cold/permission整组复验中，不能沿用旧通过。root已读activation guard。
- 闪白白盒裁决：tag4.18.13的useSize默认RO后再rAF，公开skip只删除这一延期；实测补偿仍直接scrollBy、无range DOM ack，估高deviationCommitted及fallback另在。因此有明确局部机制依据，但不能宣称全链paint原子。三版内部补丁均不准生产；测试负责验证这些边界，不以通过次数替代机制论证。
- 最新用户裁决覆盖旧Waiting方案：消息区从挂载起固定底部留白（实现候选48px，collapsed40px+间距8px），不随等待区出现/收展/handoff变化。停止target/actual obstruction、动态Footer/reveal与补偿方案；waiting_layout写Surface/CSS，list_owner删除对应动态adapter链。原reduced717px反例是废弃候选的拒绝依据，不再沿它继续复杂化。当前施工，未验收。
- 最新真实App公开skipRAF验证：true stationary/continuous均未捕获白帧，RO报告有限且静置1秒无新增；false stationary同轨也无白，故没有生产去白增量因果证据，不合生产。sparse仅物化3/5匹配仍红，ux与browser核扫描/准入/物化边界；不能用零白关闭完整体验。
- 授权：用户已明确允许尝试隔离修改组件源码；不是生产依赖替换批准。五分钟过程监工，禁止以后端、部署或未知进程变更扩大范围。
- 历史闪白：三版隔离源码补丁均拒绝晋级（去白但画错内容或丢锚）。最新同源 stationary 对照中，原版4.18.13仅开启公开 `skipAnimationFrameInResizeObserver` 即保持 row-0、无白帧，补丁无增量收益；两臂均有RO-loop报告。root已读 `audit-output/virtuoso-candidate3-skipraf-3f839c-20260918/SKIPRAF-AB.md`。browser_fuzz正用真实App独立快照验证连续输入、历史加载、稀疏过滤和错误是否持续；尚未启用生产，不称全场景解决。
- 等待区：Footer公开RO接回唯一issuer后，普通following/browsing候选2/2；reduced-motion新轨仍有Surface31而Footer0的跨commit错位，出现717px大跳，拒绝合入。waiting_layout与list_owner联合定位同一空间快照提交。仅可解释的过程亚像素量化允许<=2 CSS px候选，绝不放宽大跳、正文/控制遮挡或永久裁剪；终态底部gap<=1。
- 恢复：用户已明确历史浏览只需保持阅读上下文、无大幅跳动，不要求像素复原；15.4375px不再作为独立阻塞。list_owner正在删减多余精确finalize；原先处于底部则返回真实当前底部，用户输入接管仍必须成立。
- 冷频道/权限：固定 `713` 快照 cold3/3、permission2/2；与27f仅restore代码不同，权限书签直接相关，不能代签当前整合。cold无恢复目标分支不受直接影响。
- 稀疏过滤：只有扫描反馈/EOF子项通过（同operation升级interactive、47批同Loading）。多匹配各自purePrepend仍造成逐批换锚，整体未闭；architecture_review与ux_frontend并行推进上层受控空间接续，不能把零白帧当成平滑动画完成。独立“确认”按钮已删并恢复旧成员点击行为，unit2/browser3/build通过。
- Timer可见性：canonical timer事件及parent/correlation续工闭包已恢复到@我，38unit/真实App1通过，普通agent自查询仍不冒充human关联。未关闭真实闹铃。
- @我：无human边selfCommission准入已删除，真实关联闭包保留；scope36unit/App守门通过。表格完整App1/1、selection2/2、内容部件8/8有对应快照证据。
- 真实页面：502时5173无监听，root恢复Vite并确认公网/App/health200；watch排除测试证据。测试只用独立快照/端口，不再共享仓起多服务。
- 手动折叠：用户当前体验正常，旧反例只列待核，不称当前确定故障。字体、任意100k阈值不是本次主线前置。整体验收未完成，旧通过不自动继承新源码。

更新：2026-09-17。负责人：执行本次前端重构的Codex。当前状态：**用户确认产品没有任意消息/引用/search定位，只有回到底部；§9.8据虚构的一般导航硬门推出Legend源码fork的条件结论已撤回。Legend 3.3.11迁移进入生产后，P0-4/C1真实Chromium 0/3硬失败；当前工作树因此已安全回退React Virtuoso 4.18.13单一生产实现。** Timeline仍导入误名`LegendMessageList.jsx`，但内部实际import/render Virtuoso；`@legendapp/list`只剩残留，不是并行生产。当前准入边界上C1/takeover 4/4与历史tail下方+28轨迹1/1已绿；prepend compositor仍三seed各一白帧，bookmark为unmaterialized/Infinity，fold缺collapse control，旧waiting 1/2红。六hash fuzz v3同SHA完整结果为1/7；最近完整unit边界843/843且integrity4/4，但两者均早于当前W4/W5施工，现树尚未重签。W2/W4有已批准未实现的结构P0；W5第二权威方案已撤销，canonical Replica→stateless WaitingPresentation状态等待root归一矩阵。fork/vendor/依赖源码修改仍未授权，现代码不能交付或部署。

此文件是续工检查单及候选决策记录，不是降低要求的替代规格。用户不承担逐例测试、提醒续工、选择API或替工程师修改设计的职责。**当前已获完整前端实施、review与测试授权**；仍禁止修改依赖源码、后端、服务、部署、分支或提交。早期“只授权三份主文档”的文字只描述当时阶段，不能覆盖本表。

## 0. 唯一当前交付表（2026-09-17）

### Root 完整进度复核（用户要求“完整检查进度”后）

本段由 root 亲自维护、裁决；下方工作包表与历史增量有滞后时以本段为准。子 Agent 只提供分域证据。当前阶段为实施补齐、修复及集成，未进入最终验收；此前“只剩三个/四个门”和 60–90 分钟交付估计撤回。完整交付范围仍为 W1–W8 与 UX 索引的全部 12 组。

| 范围 | 本次核对结果 | 后续动作与责任 |
|---|---|---|
| W1 同步、身份、缓存、权限 | 冷入口/过滤有具名浏览器通过；权限、后台恢复和当前树完整生命周期未重签 | loading_owner / ux_frontend 复审；root 签收 |
| W2 历史供给 | 跨批过滤与静默 loading 定向通过；语义历史单位/已完成过程内容整理仍有设计实现缺口 | root 审核语义投影范围后分派；不得从交付范围删除 |
| W3 列表、回底、未读 | 显式 latest 被错误等待新高度通知与提前清 unseen 已定位，list_owner 施工中；append gap519、折叠大跳、恢复 Infinity、prepend 白帧尚未关闭 | list_owner 唯一生产接线；browser_fuzz 独立验证 |
| W4 内容、折叠、选择 | latest request 入口已补，owner 报模型37/37及完整App1/1；高度事务仍集成中。新发现流式→terminal更换正文key，选区/实例连续性未闭；长文CPU、回收Selection仍开 | fold_owner / content_owner 分工，root 审核共享写入与验收 |
| W5 等待区 | 第二权威已删除；Replica compact terminal closure 已落盘并获静态审。owner 报跨页→裁剪→旧queued生产链78/78及build通过；真实浏览器最终复跑中 | sync_audit 提供最终产物；root 不能把防僵尸通过扩成全部任务/操作通过 |
| W6 草稿、Outbox、发送 | 数据侧及窄发送轨迹通过；完整浏览态发送仍有 intent1/write0 反例，与窄轨迹差异未闭 | submission_owner 与 list_owner 联合归因 |
| W7 布局、环境 | Waiting外框零漂移仅历史具名轨迹通过；当前集成待重签。Android触摸/键盘、旋转、安全区及遮挡命中缺证据 | performance_review 分域复审；root 保留设备门 |
| W8 架构、文档、验收 | 最近完整unit843/843早于当前改动；最近同源fuzz1/7。残留清理、设计一致性与同源完整验收未完成 | root 统一冻结与签收；design_docs 仅同步已裁决事实 |

当前实际团队：10 个子 Agent 运行（browser_fuzz/content_owner/design_docs/fold_owner/list_owner/loading_owner/performance_review/submission_owner/sync_audit/ux_frontend），4 个完成上一任务，1 个 interrupted；并非15个都在施工。未关闭项必须保留到具名反例在对应源码上被复验替代。全量历史原话追溯尚有 source-pending 项，不宣称所有历史反馈已逐条恢复。

### 工作包证据底账

Root 最新汇报边界：未读已完成record-root改造与独立完整App旧缓存reload复签1/1，保留有效seq/书签/cursor，失效无依据count/key，点击真实tail后清零；不再继承此前三计数或legacy运行分支。当前发送浏览态仍有一次延迟约849ms、无intent的list-commit第二写+181px反例，list_owner处理中。Waiting视觉handoff自身3/3不能代替发送几何。原4101在a30ef213/22f103d3/5f514978固定源码真实白帧FAIL，折叠重复补偿仍无准入修法。新增c0查询刷屏：只读账本证明steward定时复盘54次有限分页；前端isSelfCommission把agent自委托纳入@我并扩展整个correlation，查询请求/回复并无人类audience，此范围语义问题已定位、未修改。root负责后续产品语义裁决，不能仅按query类型隐藏。

Root 最新完整汇报增量（用户报告新动态按钮消不掉）：按钮门重新打开，22f103d3的2/2仅为原点击轨迹；list_owner/ux_frontend检查physical-tail→visible evidence→unseen确认，禁止强清零。content_owner稳定答案slot已报Chromium4/4、unit101/build通过，覆盖同文/续写Selection与实例存活；折叠隐藏区Tab仍可聚焦为新P1。当前4-file58/58包含scope书签初始化修复，仅unit门。loading_owner最新cold/underfill/filter浏览器6项5绿1红：无缓存入口在正文就绪前误显示filtered partial，约883ms；已裁决首可读范围未建立时使用首次加载态。architecture已闭合prepend第二次修正与fold二次跳均经过Virtuoso按总extent差的generic resize补偿；fold先browser clamp后重复补偿，role-height ack不得称为其修法。两次反向anchor补偿提案尚未准入。list_owner已给3分钟冻结供原4101复验，未获结果前白帧仍红。

Root 最新任务状况（用户“进度！！！任务状况！！！”）：
- sync_audit：consumer重复注册/释放泄漏修复完成，StrictMode/A→B→A/卸载及closure回归40/40、build/diff-check通过，digest `0c47283a4307b28e77a95ff60929608a191b10e32b39ad8a31595bcdd0b95ff8`。
- list_owner：生产adapter尚未改（`4f44e25e`）；35项中3红明确复现latest零写、following过早消费授权、提前清unseen；另修waiting目标误用timeline旧高度。尚未完成，不许报已修。
- submission_owner：已批准修慢receipt阻塞连续发送、旧批次错误反馈丢失、durable失败残留bottom intent；Timeline小块接线由其协调，ReadingSession精确token撤销由list_owner实施。
- waiting_layout：已批准纯展示淡出/淡入；不采纳正文复制portal飞行动画。快速queued→completed也必须连续，屏外不触发定位。
- browser_fuzz：已要求当前只读快照立即诊断闪白，避免无限等共享源码冻结；最终验收仍须同freeze。
- W3 render期发布refs及initial viewability生命周期、W4 roleRevision高度ack仍未闭，归入整体交付阻塞。

Root 补记用户明确的两个交互缺口（均未关闭）：历史 foreground loading→可读历史的连续过渡（loading_owner），Waiting queued→正文 running 的连续过渡（waiting_layout）。展示过渡须保留逻辑消息身份、可操作性与读屏唯一性，处理重复事实、快速终结、切频道和 reduced-motion；不允许移动已有正文、动画主滚动坐标或冻结用户滚动。列表白帧/跳位仍由 list_owner 独立修复，不以淡入淡出替代几何验收。

Root 本轮新增裁决：sync_audit 已交 Waiting 最终 browser 1/1、跨页集成与 focused 78/78、build/diff-check 通过，核心 digest `d043a1404c6a48dd7e38a6b73a21021b35a666186b52f23972bfe4e94a3f9a0c`。关闭本轮 terminal-first→trim→older queued 僵尸反例；保留 compact terminal 正文/错误摘要缺失为内容保真未闭项。UX 当前即时44项有3红（explicit latest 0writer、ordinary following height 0writer、latest提前清unseen）。另外浏览态send已定位为临时timeline高度2421被错误用于waiting目标当前高度2289的准入，list_owner修复中。这些红门继续阻塞整体交付。

本表只使用以下状态词，后文旧记录若与本表冲突，以本表和时间更晚的具名增量为准：

- **已实现/已接线**：代码入口已在当前工作树出现；不表示行为门通过。
- **定向通过**：只对列出的文件、命令或具名轨迹有效；不能拼成完整验收。
- **完整验收通过**：同一冻结源码上的完整unit、完整生产browser、行为fuzz、build及要求的设备门全部通过。当前没有这项结论。
- **失败/未闭**：存在可复现反例、失败测试或必要证据缺失；不得用相邻通过覆盖。
- **历史候选/历史证据**：只解释取舍或提供迁移回归输入；不是当前生产状态，也不把成绩继承给新adapter。

UX状态的唯一当前索引是[Conversation UX model audit](CONVERSATION-UX-MODEL-AUDIT.md)的“Current tracking index”；其下历史UX-01–05保留事故链，不等于当前仍失败。数据/恢复补证见[UX-B数据审计](CONVERSATION-UX-DATA-AUDIT.md)。原42条、N01–N12、F01–F29与Q01–Q20仍由spec §11.1及场景总账追溯，索引存在不等于测试通过。

| 包 | 已实现的生产入口 | 最新有效证据 | 尚未实现/未闭门 |
|---|---|---|---|
| W1 身份/同步/Replica | `useChannelFeed`、Sync obligation、Replica、feed cache、arrival/unread身份已接生产；connectionEpoch拒绝旧连接迟到probe/catchup；hidden→visible只建一次interest；权威Meta `head=0`可完成零目标。unseen只来自accepted live commit，ack须current activation与同DOM materialization | **定向通过：** sync/startup16/16、cursors+reading26/26、UX-A09 browser3/3、cold browser3/3。“@我”按human principal跨incarnation，普通成员仍exact actor/stale可移除；UX合跑6/6。最新filter first-frame2/2 | 完整App权限/错误/hidden paint-ready、真实服务仍未验；当前bookmark恢复红为target unmaterialized/Infinity。无`system.log.query`、后端或协议修改；visible兴趣不是轮询 |
| W2 历史持续需求 | HistoryScheduler/reservoir/coverage与`historyDemand {revision, phase}`已接；zero-projection supply按当前filter到first match或权威EOF，filter切换Abort旧view obligation，DOM key按channel稳定 | loading/filter Chromium3/3、unit64/64、build；runway/cross-physical具名证据保留 | **P0结构缺口：** 当前history仍以raw record reservoir/release满足，terminal turn保留全部provisional；须实现`ConversationHistoryProjection`语义unit层，让HistoryDemand按unit满足。8 raw/256KiB不是语义或像素上界；仍只复用既有Scheduler/`history_before`，不增协议/poller |
| W3 阅读/列表 | 最终四hash：Timeline`9e85d822…`、useReading`c42567eb…`、adapter`4f44e25e…`、txn`ac6dea2b…`。Virtuoso4.18.13、`followOutput=false`，ReadingSession唯一DOM issuer；send pure txn exact join，waiting只记exact inserted；无timer/rAF补偿/private patch | focused67/67+build；filter2/2、C1/takeover4/4、canonical CDP send2/2、历史+28轨迹1/1绿 | prepend 4101–03各1白帧；bookmark unmaterialized/Infinity；fold control absent；旧waiting1/2红。最终同SHA fuzz **1/7**：3 append gap519、2 fold top2185→451.656、browsing send intent1/writer0/gap1764失败；只有following send通过。render refs/initial-ready、50ms、Android仍开 |
| W4 Presentation/Content/Choices | 不可变Presentation、稳定row/root revision与ContentPlan已接：稳定blockID、保守局部编辑、sealed DOM、有限store、bookmark describe/resolve。正确fold语义为current-entry无override时展开，失去角色且无override才折叠，override持久 | Content6 files/42、build、Chromium2/2；clipboard/resolver具名路径绿。fold/latest模型36/36，但生产只半迁移 | **latest/fold authority未闭：** Presentation候选须由ReadingSession以exact epoch/view/source/candidate + coverage(candidate.seqHigh→head)授权；不能用Timeline `findLast`/loaded rows/bottomReady。仍缺roleRevision + adapter public height ack；role false→true高度、cache-first following/wheel、生产fold、长文CPU、回收selection、A07等未闭 |
| W5 Waiting证据/操作 | 自动query保持关闭；唯一审定链为Gateway→canonical Replica fold→stateless WaitingPresentation→WaitingLayer。HistoryScheduler无Waiting专用输出；roster/content/controls只作为派生门 | **施工中，未签署完成：** TaskEvidence/ControlDiscovery第二权威方案已撤销；具体diff和证据状态等待root归一矩阵，修前7/89及三条browser不继承 | 同一新链须重签乱序/terminal、root-turn history、compact/eviction、HMR/existing-cache、真实browser及动作门。无后台`system.log.query`、第二cursor、后端或协议改动 |
| W6 草稿/Outbox/发送 | revision草稿、durable accept、稳定ID、receipt/feed对账、离线编辑；send-start首await前唯一bottom intent，accept只校验/消费token，receipt/feed/retry无滚动入口；feed-before-hydration tombstone、open-generation去重、uncertain/rejected不自激、显式retry同ID、结构日志无正文 | **W6发送/Outbox窄范围闭合：** final四hash上production CDP repeat2 2/2；每条精确1 send-start intent、1 writer，outbox/transmit/receipt/feed各1；trusted wheel epoch1→2后18/19 ordinary-stream issuer均not-authorized、0二写。数据focused25/25；canonical FINAL6曾2/2 | 无发送侧未闭门；但不替W3旧waiting1/2红、prepend/bookmark/fold或W7设备/几何背书。最近843/843也不扩大W6轨迹，且现树须重签 |
| W7 Surface/环境 | 32px输入增长、等待浮层、移动布局、侧栏/terminal readiness；Observer/naturalHeight及overflow/padding只归input slot，WaitingLayer绝对浮动 | canonical CDP确认Waiting mount/唯一writer同帧、promote/completed后browsing gap2135；final fuzz following-send通过且mount后0 writer/gap0；历史FINAL6零外框漂移 | browsing fuzz intent1但writer0、gap1764未回底；旧waiting1/2也红。Android键盘/触摸、rotation/safe-area、视觉/命中仍开 |
| W8 删除/统一接线/验收 | 旧viewport/measured/history interaction/VirtualAdapter等已删；单Virtuoso生产链已接，Legend包/误名文件仍是残留 | 最近完整unit边界同次JSON 289/289 suites、843/843 tests、0 fail/exit0、integrity4/4；六hash fuzz v3前后hash一致且1/7。两者都早于当前W4/W5施工 | 现树尚无完整同freeze unit/browser/fuzz/build总账；先前fuzz六失败仍是硬反例。W2/W4/W5结构P0、W3/W7、Android与残留清理仍开，不能称完整交付 |

证据边界：完整browser的151/4/1早于consumer、near-edge、W5/W6及最新输入/空态/身份语义修订；其原目录又已丢失。当前具名focused不能拼接成“最新源码全量通过”。2026-09-17已在同一冻结源码指纹下以独占output完成两条重签：生产runway 1/1通过，原30项压力oracle 1/1失败；后者的逐帧JPEG、timeline、summary、oracle和trace均在断言前持久化。白屏仍由本owner负责且明确未验收。

两轮历史“四失败”必须按原ID追踪，不能用后来的总数覆盖：

| 历史冻结轮/失败 | 当前状态 | 对应证据边界 |
|---|---|---|
| `full-browser-final-5`：append首样本gap约277 | 已实施CommitAwareList commit→同turn microtask→唯一issuer；严格轨迹focused 10/10 | 后续完整轮未再列该项，但最新工作树没有完整browser复签 |
| 同轮：browsing时锚下方行+28 | **历史失败；当前准入边界已定向修复** | 原应用issuer=0且Virtuoso写`scrollBy(+28)`的反例保留；当前对应生产轨迹1/1绿，不外推其他resize/fold |
| 同轮：C1旧index retry | 已由builtin follow恒false及当前owner/epoch issuer接入关闭 | C1/noappend/noresize/nested focused 6/6；未改库源码 |
| 同轮：C1旧SIZE_INCREASED订阅 | 同上，不再注册该builtin follow工作 | 同一6/6 focused；不能冒充initial retry关闭 |
| `full-browser-list-commit-frozen`：F3 Composer高度0 | readiness oracle改为生产list和非零Composer commit；另验可见input时surface 76/input 30且restore中可输入 | focused通过，之后无完整browser复签 |
| 同轮：fold原`≤1px` | **未闭** | 仍有0.875–1.0625px波动及一次大跳证据；未放宽阈值 |
| 同轮：B-BR-06未真实submit | 已修前置，另加B06a早操作：警告、零`agent.ask`、草稿保留，ready后同草稿真提交/PONG | focused通过，区分成功/uncertain与早阻止 |
| 同轮：browsing时锚下方行+28 | **历史失败；当前定向1/1绿** | 与上面同一旧反例；只由当前同名轨迹取代，不改写当时完整轮数字 |

当前施工顺序固定为“实施补齐 + 缺陷修正”，不是“主体完成只剩验收”：

1. **P1：** 当前W2/W3历史接续、UX01 tail无效down、UX02 selection来源及惯性跨runway，完成一轮生产browser。白帧若仍失败保留原证据，不无限调overscan或重复跑；只有存在输入模型因果时才与W4合并，不预称拆块根治。
2. **P2：** UX03离线编辑/本地durable queued与传输权限、UX04可用性空态、UX05身份迟到后的范围/稳定身份语义，逐owner补实现和正常旅程回归。
3. **P3：** 对明确未实现的W4超长展示粒度/依赖更新及W5主动任务补证、未知任务发现先做具体前端owner方案审，再实现；不改后端/协议，不突击大拆。
4. **P4：** 全部生产接线与删除审查后冻结同源源码，运行完整unit、完整生产browser、行为fuzz、build，并单列真实设备限制。

## 1. 续工先读与现场保护

1. 读取本文件、总设计、施工规格和场景总账；核对工作树，再继续未完成项，不从零重写。
2. 本次核对前端分支为 `refactor/conversation-frontend-r3`，HEAD 为 `193f189cd3ae63cf3deb9e54d71d7bbeb9fd304c`，有大量未提交修改。HEAD 不代表当前被审查代码；后续证据必须包含工作树差异或对应提交。
3. 不覆盖已有修改、不切走用户当前产品、不复制 dist、不重启服务。后端代码、协议、存储及产物不在授权修改范围。
4. 任何状态“完成”必须指向证据。旧轮次通过数不能作为当前工作树通过数；未取回结果的测试算未知。模型测试、夹具、完整应用和真实设备是不同证据级别。
5. 本文件规定审查方法，不自动执行后台任务。续工时必须更新实际进展、失败证据及下一项，不能以写完此文件当作修复完成。

## 2. 已确认的偏差与尚未确认的问题

| ID | 现状/证据入口 | 归类 | 必须关闭的条件 |
|---|---|---|---|
| R01 | 先前核验 `MessageList.jsx` 的 commitBookmark 与 pendingContentAnchor 计算DOM偏差，叠加库补偿后调用scrollToOffset | 实现违反单一几何权威 | 只能存在一个经准入的执行边界；若用完整组件不得外加补偿，若改为受控执行器须另证下层真正被动及完整责任，不能把旧补丁搬进去追认 |
| R02 | 先前核验 `settleNavigation` 逐帧重试，取消以另一定位替换；其大部分服务于现已确认不存在的任意消息定位 | 实现的控制职责重叠，且产品模型越界 | 删除虚构目标导航和外层补偿；只为回底保留一次公共操作，并用真实“回底/尾随→向上”交接验证，不再要求通用导航状态机 |
| R03 | 初次核验依赖react-virtual 3.14.13/core 3.17.11而spec仍称当前Virtuoso；本轮已将该段标为历史 | 原证据脱节已在文档修正，运行准入仍缺 | 新提案不能继承旧测试；记录实际代码/范围/版本证据，不以文案修正合理化违约实现 |
| R04 | 已发现恢复期间保存临时位置、local echo/确认后展示子树身份变化；存在修订但未形成完整交付证据 | 状态转换与展示身份缺陷 | 用真实ReadingSession/store及local→receipt/feed反序验证；修订存在不等于通过 |
| R05 | task-evidence 对已知 turns 做证据过滤；是否完整实现主动补证和发现进度尚待核对 | 待核验，不先定为库或后端缺陷 | 对照W5追踪真实端口、持续需求、失败重试；既不复活queued，也不以永久unknown完成需求 |
| R06 | 部分定向测试曾通过；当前全套、具名场景覆盖、设备证据未闭合 | 验证不完整 | 建立逐场景证据，不用局部通过数宣称整体正确 |

上述R01/R02的判断不是“ref多或文件大就错误”。执行句柄可以存在，但不能成为另一个决定目标、补偿和完成条件的权威。调用成熟组件API也不自动满足约束：必须追踪谁计算位置、谁发出命令。

## 3. 待办顺序与退出条件

- [ ] T1 冻结真实位置入口：只列initial/restore、真正频道或不连续消息集切换、prepend、append/follow、内容resize、回底、原生输入/focus；删除任意消息/引用/search定位及其scroll出口。逐项记录公开组件机制、应用策略和观测，后台数据不得创建额外回底。
- [x] T2a 纠正选型硬门：§9.7/9.8证明三库缺通用cancel，但用户确认的产品没有一般目标导航；从该缺口推出必须Legend fork证据不足，现撤回。Stream采用Virtuoso证明的是成熟正常接入存在，不冒充本项目已通过。
- [ ] T2b 关闭W0能力门：按§9.9以React Virtuoso 4.18.13公共API正常接入，在现有项目核验真实C1–C5；首个止损卡只覆盖回底/append pending或active→立即向上、同时resize。无失败证据不改库源码，不另建demo或商业试用。
- [ ] T3 收敛实现：删除虚构导航状态机、R01/R02外层补偿和死状态；保留正确Replica/Presentation/Reading模型。ReadingSession只持following/browsing与书签，Adapter映射initial/firstItemIndex/followOutput及一次回底，不建立执行任务或取消控制器。
- [ ] T4 全量合同核验：按W1–W8核对实际入口和职责，覆盖同步持续推进、不可变提交、稳定身份、任务证据、草稿/发送、页面布局和权限隔离。不是只改列表然后宣称系统完成。
- [ ] T5 反方review：逐条执行下节；对每条结论主动构造反例。失败回到责任层修，不能在相邻层补偿。修订后重新审查相关合同，记录撤回的旧判断。
- [ ] T6 集中验收：整体接线/删除完成后运行完整模型、功能、真实浏览器与行为fuzz、构建；W0能力实验不等同完整验收。所有失败/skip都归账；保留trace、seed、最小轨迹及版本。
- [ ] T7 交付核验：设计/实现/证据三者一致，形成可审查差异和可回退版本；未获得发布授权不操作服务或覆盖产物。仍有缺口如实未完成，不交给用户试错收尾。

## 4. 每次修订的自我批判模板

每个修订记录以下内容，缺项不得标记review通过：

1. **反例**：起始阅读状态、用户动作、后端/缓存/环境事件及顺序；用户看见的错误是什么？
2. **责任分类**：设计能力缺口、实现违约、重叠权威、合法实现中的边界bug、或待确认；不能笼统写“时序问题”。
3. **责任与入口**：哪个owner拥有该事实/意图/几何？谁调用它？修复是否偷偷让另一个owner写入？
4. **机制解释**：为什么对整个事件类别成立，而不是只对当前延迟、行数或测试数据成立？有没有引入超时常数或再试一帧掩盖失败？
5. **反方追问**：用户在请求后继续滑动怎么办？取消后尺寸再变怎么办？A→B→A时旧清理晚到怎么办？没有下一条push怎么办？
6. **测试质量**：测试是否使用生产状态链？oracle是否独立于实现？是否只断言最终位置而漏掉中途跳动？mock是否提供了真实协议没有的保证？
7. **删除与证据**：删掉了哪条错误机制？给出实际测试命令、结果、工作树/提交、trace/seed路径及未验证范围。

禁止用删除有效场景、放宽位移阈值、增加等待、重试整项测试、冻结正文、隐藏消息、永久unknown或恢复旧控制器来让结果变绿。过时结构断言可以替换，但必须保留用户行为断言并记录原因。

## 5. 自主验收矩阵

完整枚举见场景总账的原42条、N01–N12及F01–F29；必须建立“场景ID → 生产路径 → 测试 → 证据 → 状态”映射，不能以此处概要替代。

| 过程 | 必须主动组合的事件 | 判据 |
|---|---|---|
| 进入/切换 | 无缓存、慢缓存、无push、Meta失败、A→B→A、迟到清理 | 可用内容立即可见；同步需求持续推进；当前用户意图不被旧激活覆盖 |
| 历史阅读 | 冷长短行、连续触顶、反向惯性、prepend+append+补洞、超时/重复页 | 当前存活内容连续；无后台导航；边界等待不清空原窗口 |
| 实时与内容 | following/browsing各自遇到流式/终态、local echo确认、展开回收、字体/图片/宽度变化 | 非跟随不抢位置；展示身份/选择稳定；段内不只验证行顶 |
| 用户接管 | 点击回底或append尾随后立即wheel/touch/键盘/拖动向上，同时晚resize | 用户上滑后不再被拉回底；内部滚动不误接管外层；选择与焦点保留 |
| 输入和页面 | IME、回复/附件增长、任务/网络状态、移动目录/Preview往返 | 状态不改外框；内容增长合同及32px；按钮真实命中、焦点无隐式跳位 |
| 事实与持久化 | 终态先到、旧queued缓存、断连重启、账号切换、IDB失败、多tab | 不伪造状态、不丢新草稿、不串账号；失败可见且义务可恢复 |

行为fuzz使用独立参考模型生成用户/后端/环境交错，保存seed并缩减失败轨迹；UI使用真实ReadingSession/store与生产列表，不只stub reading对象。位置oracle区分用户实际滚动与程序写入，不把wheel.delta当实际位移；检查每个可观测帧而非只看最终位置，并保留合成线程/真实设备证据限制。

在隔离mock环境运行：`npm test`、`npm run test:browser`、`npm run build`；全量browser不能被筛选版`test:browser:ci`替代。当前Playwright隔离端口15173/18832，禁止复用真实服务端口8832；端口冲突不杀未知进程。运行前记录配置，完成后保留失败产物。

## 6. 进展账与下一步

早期设计审查阶段已经结束，§7–§9.9只保留其候选决策与反证，不再描述当前执行范围。当前事实以页首§0为准：W1–W8生产链已经进入实施和审查；Virtuoso阶段、Legend失败迁移及19:42后的Virtuoso安全回退是三个不同证据阶段。不能再用早期范围文字描述当前工作树，也不能在阶段间继承通过；当前回退状态见§9.10.23。

W2/W3有界历史交接已经接通并取得生产runway及真实输入浏览器证据，但W2语义unit仍未实现。W5自动query/feed端口已删除；修前fresh路径7 files/89及phase-c、same-DOM terminal、capacity各1/1之后，用户HMR页仍出现zombie，P0重开。TaskEvidence/ControlDiscovery第二权威方案已撤销，Gateway→canonical Replica fold→stateless WaitingPresentation→WaitingLayer的具体diff和证据状态等待root归一矩阵；旧7/89不继承。W4 ContentPlan已接但coarse多unit和latest authority仍未实现。当前列表准入边界C1/takeover4/4、历史+28轨迹1/1绿；prepend三seed白帧、fold control absent、bookmark unmaterialized/Infinity及Android仍开。六hashfuzz v3为1/7。不能用增大窗口、隐藏内容或反向补偿刷绿；没有具体责任证据不申请fork/vendor，也不重启泛选型。

续工记录格式：时间/代码标识；完成项及证据；失败反例及归属；实际修改范围；未闭合项；下一项。每轮自行更新，不等用户询问。只有需要新增授权或无法安全推进的外部条件时才请求用户决定；普通测试失败由执行者继续处理。

## 7. 历次候选决策记录（历史过程；当前结论见§9）

本节保留当时的判断、反例及建议，包括随后被纠正的“A优先”“B暂不推荐”。其中“下一步/当前”均指该小节阶段，不作为今天并行生效的指令。实际事实不改写，最新裁决及继续动作只取§9。

### 7.1 已有证据与撤回项

- 当前安装记录为react-virtual 3.14.13 / virtual-core 3.17.11。先前隔离夹具在1100/390宽度报告：原版issued导航在接管后仍有auto写入；单条长消息前插内部块后，屏幕首段身份改变。限定于该夹具，不能等同完整设备验收或证明整个库永远不可用。
- 按behavior临时放行的scroll-authority试验阻止了该夹具的晚写，但不是公开cancel保证。私有导航任务可能仍在，新授权是否会放行旧任务没有闭合；段内插入仍失败。不得把它移入正式设计当最终解。
- 被动TanStack提案的只读检查：`anchorTo:'start'`、`followOnAppend:false`、公开实例回调`shouldAdjustScrollPositionOnItemSizeChange=()=>false`、禁止所有定位API、`directDomUpdates:false`、no-op scrollToFn，可切断已追踪的主要主动来源；**不能由此证明完全被动**。挂载仍记录私有意图offset，后续真实观测可能被1.5px容差替代；关闭end anchoring也失去render前keyed prepend范围调整。单一容差不是整体否决理由，核心缺口是数据/offset/range/DOM/首次paint的一致性及可撤销授权没有公共边界证据。
- 因此撤回总设计“选定被动TanStack”及其已成立的模块权威映射。这条具体提案不准入当前完整施工；不继续设计如何压制该库私有行为。真正纯计算的路线仍可比较，但不能沿用其名字偷带上述机制。

本次只有源码/文档阅读；没有新运行实验。上述试验来自前一阶段执行记录，当前没有把工具输出升级为完整可复核测试报告。

### 7.2 三条路线及成本比较

比较固定原UX、spec §12负载/预算，以及U/B/E/J、原42+N01–N12、F01–F29。不通过缩小负载、永久unknown、冻结正文或丢书签使路线成立。

| 维度 | A 完整消息列表组件 | B 真正被动布局计算 + 唯一受控执行器 | C 浏览器原生流布局/锚定 |
|---|---|---|---|
| 控制权 | ReadingSession授权；一个组件执行所有程序几何，应用无反向补偿；原生输入必须撤销失效操作 | ReadingSession授权；应用执行器独占写入；计算器只能由显式输入计算结果，无私有滚动目标；浏览器保留原生用户运动 | 原生滚动/布局负责常态阅读；显式导航由一个应用出口发起；必须解决自动锚定与程序跟随的边界，不能再加并行补偿 |
| 变高历史/混合更新 | 需消息语义事务而不只prepend索引；未知高度与混合变化的首次paint仍须证据。MIT Virtuoso特定冷prepend接入已有失败，不推断全部完整组件失败 | 需自行建立data+layout+viewport的一致提交。纯计算器不自动完成测量/paint原子性；这是主要开发义务，不是薄适配 | 浏览器锚定可能保持DOM内容，但锚点选择、抑制条件、删除与高度回算不等同产品合同；单靠CSS不能宣称通过 |
| 段内变化 | 稳定块/文本点仍由Content提供。items-change/稳定row key不证明读到的段落不移动；须核对公开的细粒度锚定或等效能力 | 应用实现语义点、删除fallback、字体/换行/媒体观测与提交；即使尺寸树复用，语义测量责任仍自行承担 | 保留真实文本节点有利于选择，但原生锚点未必是用户阅读点；字体/段内前插/流式改写仍有反例门槛 |
| issued后取消 | 不强求API一定叫cancel；可由可撤销执行、无延迟写入的有限执行等公开语义满足。不能只取消应用token或以新定位覆盖 | 在唯一执行器每次写前校验原授权；不得下放无法撤销任务。但惯性、同帧用户运动、程序read-back识别都要自行验证 | 即时定位可避免应用重试；浏览器smooth/焦点默认滚动和后续锚定仍须归因。不能未经产品确认取消既有动画或焦点行为 |
| 选择/焦点 | 需公开pin/保留机制或证据证明有效选择不被回收；稳定key本身不够 | 执行器承担活动节点保留、范围和资源预算；选择/编辑器不允许作为普通行回收 | 原生节点未卸载时最直接；一旦为预算删除DOM，就重新引入窗口及选择保护责任 |
| 性能/内存 | 成熟虚拟化有机会复用大部分机制，仍须100k本地/2k模型/100k字符及输入预算实测；商业许可不等于性能保证 | 可以保留一个成熟尺寸/范围算法，但应用承担commit、观测和快速物化；实现和审查成本最高，不能称“仅数行适配” | content-visibility可减少部分渲染工作，不能消除DOM和文本内存。全量挂载不满足原DOM预算；滑动删页又需新窗口控制，当前不准入 |
| 当前证据/未知 | 无完整候选已通过。官方MessageList仅有历史公开操作语义调查；段内、取消、选择未知 | 当前no-op TanStack具体提案不准入；未找到并核验真正纯计算候选，不宣称已有满足者 | 未运行符合负载的验证；无可证明同时满足范围保位与资源预算的接入，不把原生当万能解 |
| 维护与审批 | 包升级/接入与许可审查；商业评估安装和采购需明确同意，阅读公开资料不等于购买 | 实质新增应用级滚动引擎责任；需明确技术范围审查，不得从“单一控制”推导自动批准自写引擎/fork | 若降低DOM/选择/加载UX要求属于产品变更需明确同意；不能借浏览器方案静默降级 |

所有路线均先使用现有Gateway view/request，均不要求因选型而改变后端。发现真实后端缺口仍按BE逐项审批，不与许可、产品取舍或前端技术范围审批合并。

### 7.3 当时推荐及已完成的有界步骤

**推荐优先判别A，不直接安装或选定A。** 理由是用户要求的最高目标不是自行拥有更多控制代码，而是在原UX下只有一套可信执行机制；若完整组件有足够公共合同，可最少承担惯性/测量/回收维护。B是明确的更高成本架构选择，不作为A失败后自动实施的后门；C目前不能用全量DOM或偷偷删页满足既定预算。

主Agent已批准并完成的下一关为：**只读核验一个完整消息组件候选——官方MessageList——的公开合同，输出必要能力映射，不安装、不跑代码、不采购。** 结果见§7.5；当时限定三组决定性问题：

1. 数据与阅读目标能否在同一公开操作边界提交，覆盖冷prepend、append+prepend、中插/删除以及尺寸变动？记录纯行级承诺和没有承诺的范围。
2. 用户接管后，已发导航和自动跟随的后续动作怎样真正失效？追踪完整生命周期，不以方法名有没有cancel直接判定。
3. 长消息中段前插、宽度变化及跨行选择能否以现有内容结构与公开接口处理？若需按稳定块组织，列出对原消息壳、折叠、选择、可达性的影响，不假定拆块等于解决段内字符重排。

逐项产出“精确API/语义 → 能证明的范围 → 反例 → 未知证据 → 最小验证”。公开资料未承诺则标未知，不能捏造已失败或已满足；明确不支持则停止该候选。不绕到压制私有行为，不无限搜索更多包。阶段报告由主Agent立即审查并推进下一项，不交还用户枚举问题。

只有静态映射没有矛盾且评估执行范围获准后，才可计划隔离验证。最小决定性验证为：

- V1：冷50条异构prepend，同时live/中插/删除，用户反向运动；记录每个可观测帧的存活内容点与加载覆盖。
- V2：issued导航→真实wheel/触摸/拖动接管→晚resize→另一新导航；旧授权不得借新任务复活，不抵消原生运动。
- V3：100k字符中段→前段改写/字体媒体/宽度变化，叠加跨三条选择与焦点；断言文本点、复制结果、节点连续性，不只测行顶。
- V4：达到spec负载并连续快反向、输入IME；分辨数据未到、解析未到与已加载窗口空洞，记录DOM/内存/输入延迟。

这些是**验证计划而非运行许可或成绩**。若必须加第二补偿、访问私有任务、冻结正文、扩大到全量DOM、静默改变动画/选择/默认折叠才能通过，则该接入否决。若只缺运行证据保持未准入，不宣称理论不可行。若公共能力明确不支持必要行为，立即报告具体缺口并停止该路线，重新做B的成本与公共纯计算边界决策，而不边改产品边找补。

### 7.4 该阶段监工清单（本轮最终状态见§8）

| 审查项 | 本轮证据/缺口 | 下一关闭动作 |
|---|---|---|
| 范围保护 | 只修改三份主文档；运行代码/依赖/后端/服务未动，现有脏树保留 | 主Agent核对本轮文件边界 |
| UX守恒 | 总设计U/B/E/J、原42+N及F追溯未删；spec W1–W8与负载未降 | 选型后逐ID补实际机制，不能仅引用场景表签通过 |
| 唯一权威 | ReadingSession意图/导航/书签、Presentation内容身份明确；几何具体执行者未准入 | 候选先闭合测量、range、写入责任，不只检查一个scroll函数 |
| 全部位置入口 | initial/restore/explicit target/follow/prepend/revise/fold/resize/focus/browser anchoring/library retry必须归一个执行链 | 下一关记录每入口的授权、执行、取消/失效及观测；当前不假称完整映射已有 |
| 单链无旁路 | 后台不能造导航、旧授权不能借新授权继续是硬合同；现guard未证明满足 | V1/V2及静态来源审查，任何第二补偿即失败 |
| 技术闭合 | 被动TanStack撤回，三候选均区分事实/未知/成本 | 先完成A的三个必要能力映射 |
| 正交生命周期 | activation/input/content/layout、A→B→A、hidden0size、mixed等合同保留 | 选型逐条代入，不能为库重置既有状态 |
| 内容与几何 | 段内失败未遗漏；稳定身份不等于稳定屏幕坐标 | V3及删除fallback/echo/折叠组合 |
| 供给与预算 | 缺数据、解析、物化分开；不全量DOM、不冻结正文 | V4独立输入和滚动oracle |
| 系统完整性 | 主动同步、Task发现补证、Outbox/草稿IME、32px/等待浮层均保留 | W1/W2/W5/W6/W7仍各自有完成义务，不因列表候选待决后置删除 |
| 归属与验证 | 设计缺口/实现违约/候选不足/边界bug分开；模型/浏览器/设备证据分开 | 失败回owner，保存独立oracle、seed、trace及工作树标识 |
| 删除与完成声明 | 旧补偿/重试未获追认；设计、候选验证、实现、浏览器验收四种状态均分开 | 技术冻结后一次性列唯一入口与删除映射，不以改名或文档字数计完成 |

本轮交付到此为止：撤回错误选择、消除文档内相互冲突的当前结论、比较候选并提出一个有限下一关；不是完整架构已准入或问题已解决。后续由主Agent审核后继续推进，不等待用户再报故障。

### 7.5 A候选公开合同核验（2026-09-17，只读）

对象为商业 `@virtuoso.dev/message-list`，不是项目安装的MIT `react-virtuoso`。以下是公开合同核验，不是已安装版本或浏览器实验；未开试用、采购或选择生产依赖。许可/费用仍须独立批准。

| 必要能力 | 精确公开入口与已知边界 | 未闭合点、最小反例与责任 |
|---|---|---|
| 数据和位置同提交 | 受控`data={data,scrollModifier}`把变更与策略放一起；`prepend`要求原首项留在新集合。命令式`data.batch`合并一个render周期；`mapWithAnchor(fn,index)`锚住更新前某项；1.18.0起`data.replace(next,{anchor:{index,position:'preserve'}})`经`itemIdentity`匹配保留项，可用于中插/删除/重排。不是只支持prepend。[更新策略](https://virtuoso.dev/message-list/scroll-modifier/)、[数据操作](https://virtuoso.dev/message-list/imperative-data-api/) | render批处理不等于每个paint的几何原子性。冷50条异构prepend+live+中插期间继续反向滚动，要求保住提交时而非请求时的内容点；当前无本项目证据。锚项删除时官方不做该项补偿，Presentation须预先选择存活fallback。不能受控更新之外再发一条独立恢复命令。归属：提交模型/接入合同；合法调用仍失败才归组件。 |
| issued导航后接管 | `scrollToItem`、`scrollIntoView`负责明确导航；`ItemLocation.done`报告完成；`cancelSmoothScroll()`明确取消当前平滑操作。数据同时改变应使用scrollModifier，不在数据提交后另发定位。[方法](https://virtuoso.dev/message-list/api-reference/imperative-api/)、[导航](https://virtuoso.dev/message-list/scrolling-to-item/) | 未找到涵盖所有非平滑定位、后续尺寸重试、touch/键盘/拖条接管的公开执行期取消合同。不能据此宣布必然失败，也不能把done当取消证明。最小反例：auto导航已发→用户接管→晚resize→新导航；旧任务不得借新授权再写。应用ReadingSession负责撤销意图；组件必须保证已接收工作的失效，不允许外层guard抵消。 |
| 段内、selection/焦点 | `DataAnchor`只接受旧项index和`position:'preserve'`；`ItemLocation`提供项索引/对齐/像素offset；`ItemContent`允许自定义内容；`computeItemKey`和`itemIdentity`分别解决节点key和数据匹配。[DataAnchor](https://virtuoso.dev/message-list/api-reference/data/)、[位置类型](https://virtuoso.dev/message-list/api-reference/scroll-location/)、[内容接口](https://virtuoso.dev/message-list/api-reference/customization/) | 项内上方新增文字导致目标字符相对项顶部移动，即使项位置完美不动，阅读点仍变位。把稳定块作为项可覆盖块间插入，不能自动覆盖块内重排/字体/宽度。公开props中未找到任意DOMRange锚定或selection/focus节点保留合同；未知内建行为不能冒充已失败。反例：长段中部阅读+前文改写，跨三项选择后反向滚动，焦点行被窗口回收。Content负责稳定语义与版本，执行组件负责几何/回收；二者缺少经证实协作边界，不能只责怪组件不懂消息。[组件props](https://virtuoso.dev/message-list/api-reference/components/) |

**判定：A仍为候选，未准入完整施工；没有证明该商业组件、或所有完整组件永远不可行。** 已明确不充分的是“整条长消息一项，稳定key+row anchor即可兑现原段内UX”这一接入论证。行级公开合同较强，不足以覆盖文本点与回收；不能用商业许可替代证明，也不能把MIT/TanStack的旧失败移植为本候选成绩。

三组最小反例分别对应V1/V2/V3；未来如获隔离评估与第三方许可批准，应先执行它们，任一需要第二补偿/私有状态/冻结正文即否决该接入，不投入全量业务施工。当前不执行验证，也不继续无界搜索公开资料。

**建议主Agent推进的下一有限动作：B路线的端到端可行性决策，不是实现。** 只在一页中推演一个真实文本锚点在“混合数据→DOM提交→测量→原生用户运动→首次paint”中的唯一执行责任，以及selection保留与有界DOM如何共存；明确哪些责任必然成为自有滚动引擎、哪一项可用已证实纯计算公共能力复用。如果仍只能靠晚RAF反向补偿、双坐标或未授权的UX降级成立，立即否决，不写完整新spec。这个动作回答是否有可承担的替代架构，避免继续为尚未闭合的A反复堆接入补丁；并不批准B、fork、实验或任何后端改动。A缺少的许可和运行证据保持独立待决，不假装通过另一路推演已经解决。

### 7.6 B路线端到端可行性关卡（只读推演，未准入）

**结论先行：B可以构造唯一授权关系，但尚未闭合几何提交时序；不据此推荐改成自有引擎。** 本关读取现有spec §12，未运行代码或查找更多库。以下是成立所需的机制与反例，不是组件能力或性能实测成绩。

固定轨迹：浏览长文中段→真实滑动中混合prepend/live/前文块内重排→容器变宽→旧导航迟到→跨行选择。假定唯一程序几何执行边界为B执行器；原生用户滚动不经应用仿真。布局计算模块只接收版本化数据/尺寸/当前观测，返回数值，没有DOM、回调计时器、私有目标或滚动方法；当前没有已核验可直接复用的具体计算库。

| 阶段与顺序 | 唯一执行边界的输入、观测与义务 | 可推导部分／仍需证据 |
|---|---|---|
| 1 浏览且继续滑动 | ReadingSession拥有browsing意图；执行器读取实际scroll/DOM，并以Content稳定文本身份记录可见语义点及其屏幕偏移。原生运动继续，不拦截wheel/touch来合成位移；不以delta替代实测。 | 意图与原生运动可分离。主线程采样不等于掌握每个合成帧，这是后续事务的条件，不得隐藏。 |
| 2 混合数据准备 | Replica接纳全部事实；Presentation形成不可变next及存活文本点映射。执行器在实际提交前采样当时的阅读点，不使用发起历史请求时书签；没有后台导航。只准备有界窗口，不能先卸载当前可见点再等新范围。 | 数据/授权版本可以静态定义。若文本自身已被改写，明确就近存活语义fallback，不能声称保留不存在的字符。 |
| 3 冷高度首次提交 | 同一执行者必须把next、当前范围、测量、offset作为一个layoutRevision提交；DOM提交后的真实文本坐标用于本次保位，不让另一个库预测offset。新历史未知高度不可直接当精确高度；首次可见paint前必须已有覆盖视窗的内容和一致坐标。 | **未闭合的第一点**：新DOM测量可能再改变range并要求新DOM。当前未证明这轮固定点计算能在有界DOM/CPU内、首次paint前完成；也未证明未知长项快滚时覆盖足够。不能以隐藏整页、全量测量、等下一帧补偿或永久保留旧正文替代。 |
| 4 容器变宽并发运动 | 宽度变化使旧layoutRevision失效，保留事实并重算；Content文本点不因换行变成另一块。执行器需要合并由布局导致的位移和期间的真实运动，而不是恢复旧scrollTop。 | **未闭合的第二点**：JS阶段不被另一JS回调打断，不代表合成线程运动停止。先读后绝对写会覆盖间隔内运动；相对写也不能未经验证声称保留移动端惯性。ResizeObserver时机本身不证明所有重排在首次paint前闭合。 |
| 5 旧导航迟到 | 任何程序定位工作携带其原activation/navigation/input版本，唯一执行者每次动作前校验。新导航产生新grant，不能覆盖旧任务所持grant；旧完成回调只能结束自己的记录。browsing保位是当前布局义务，不是恢复旧导航。 | 若没有下放不可撤销工作，旧任务不借新grant复活可用状态机证明。浏览器原生smooth仍可能有独立生命周期；未证明取消前不向浏览器提交该类工作，不能假装取消token已取消动画，也不能静默删除原UX动画。 |
| 6 跨行选择/焦点 | 选择是浏览器原生事实，Content保持文本节点身份；执行器不得回收有效选择端点/经过的节点或焦点节点。跨三行可进入活动集合，常态窗口仍有界；真实复制与焦点必须验证。 | 内容插入本身也可能令React替换文本节点；key不是DOMRange证明。spec规定活动选择另记预算；任意扩张选择的资源界限尚未定量，不能全量pin历史或清除选择换取预算。 |

坐标一致的最低要求是：真实DOM观测是当前几何事实，测量表只属于明确layoutRevision；纯计算输出不能先行冒充实际offset。数据变更引起的保位和显式导航可以共享执行权，但不能各有自己的循环、误差累计或重新授权。上述第3、4阶段尚缺可落地且经验证的提交机制，因此不能宣称“单函数写scroll”已排除闪动。

**成本与同条件比较：** B需要自行维护语义文本测量、尺寸索引/窗口、首次paint提交、原生惯性协作、导航生命周期和选择保护，实质是新的滚动引擎。与旧方案相比，唯一可能的实质进步是删除另一主动引擎及所有旁路，并建立一份版本化坐标事实；仅移走代码或更名毫无价值。A已有公开行级变更/测量/回收能力，但文本点协作和执行期接管同样未证实；B能控制更多实现细节，不意味着这些浏览器难点更容易或已解决。A的第三方许可与B的长期维护范围是不同审批事项，均不牵连后端。

**推荐与下一最小判别：** 保留A为优先评估候选，不因公开文档未知直接批准B。停止扩写B实现spec。下一关先形成共用的单轨迹验收卡：给定稳定文本点、真实运动对照、提交/尺寸/授权时间线和选择复制结果，分别暴露首次paint、接管和段内三项失败，禁止仅测最终offset。A需要独立的隔离评估/第三方许可批准后才能执行该卡；B只有先提出第3、4阶段具体可验证机制及维护范围，才有资格申请同一评估，不能先写整套代码再证明。当前只设计验收卡不需要安装或改变产品；是否批准后续评估由主Agent明确划定范围，商业许可仍另行征得用户同意。

## 8. R3.2自有引擎历史提案（已撤回为当前施工方向）

本节全部“当前/下一步/可审”仅指R3.2阶段。历史算法与审查动作保留，不再授权自研、隔离样机、库外补偿；总设计/spec已由R3.3公开组件接入替代。有限候选未知不能推出必须自写。

### 8.1 监工过程与裁决（2026-09-17）

1. 主Agent在20分钟过程检查读到A公开合同核验完成，确认mapWithAnchor/replace(anchor)是实质新证据，随即续派B有界反证，不等待用户。
2. B最初只说明控制权可集中，却未给几何闭合机制且自维护成本更高；主Agent叫停路线轮转，要求先收敛A方向与能力门、完成无需新权限的系统文档。
3. 主Agent指出G3不是“只差测试”：DataAnchor只保项位置，段内协作没有具体机制。设计Agent确认这一缺口，撤回将商业试用作为简单下一步的表述。
4. 主Agent进一步纠偏：不能停等厂家，也不能把所有几何算法误当补丁。要求B提出真正唯一执行者的算法、结构和事务。设计Agent给出CommittedLayout、稳定ID并集、同点采样、prepaint提交、内容track显式尺寸及下界窗口。
5. 主Agent认可有机制的设计进展，批准形成B完整**设计提案**，未批准引擎实现；追加clamp不能算用户运动、fallback前后必须同点等反例。总设计§6.3–6.6与spec §3/5据此修正。
6. 三文档现在统一为R3.2提案；同期W1–W8、全部UX/42+N/F/Q映射、复用删除计划继续完善。主Agent报告已核对运行文件hash与派工前一致；这是监工核对记录，不冒充设计Agent另跑了代码校验。设计Agent本轮只读代码/官方资料、用apply_patch改三份文档，未实验/安装/构建/运行测试/后端/服务/分支操作。

该过程不是无动作等审批，也不是把前一阶段结论追溯写成一直正确。§7保留旧研究作为来源，主设计/spec的当前指令已撤回A选定、商业等待及no-op被动TanStack路径。

### 8.2 历史提案的实质机制与成本（撤回，非实施指令）

- **一个Engine，不是一个函数包着两引擎。** 它拥有尺寸索引、层级内容范围、spacer和所有程序滚动；ReadingSession仍独占意图/导航生命周期。React host只有提交阶段，没有另一个follow/restore循环；无主动虚拟库、外部behavior guard或私有任务。
- **一次有界布局事务。** 旧/新窗口及活动节点ID并集保住当前DOM；mutation前采样真实点，layout阶段量同一点、更新索引/spacer，归属运动后一次最终scroll提交。临时extent防受控更新提前clamp；最终必要clamp明确归布局，anchoring/snap禁用，focus来源单列。
- **同点fallback。** 删除前从next存活集合选择并观测同一替代点，未挂载者先做有限旧版本准备；不将旧点Y0和新点Y1套同一公式。无共同点明确rebase/empty，不伪称保持不存在内容。
- **范围与内容同责。** 单元可信正下界避免无限扩张固定点，空/隐藏项不进入高度树；长消息的文本、AST/DOM密度与不可拆原子复杂块单列成本。两窗口union不累计，活动选择另记，不以项数掩盖节点数。
- **环境入口可解释。** 已提交显式track/scroller尺寸把应用可控换行收进事务；媒体/字体几何版本统一进入。不可控UA变更与真实惯性不假装静态保证，必须保留设备验证门。

这是新的自有滚动引擎维护范围，明确提议修订先前禁自写的技术约束；其成立依据不是已写代码或库名变化，而是删除所有竞争执行者并承担完整责任。主Agent目前只允许设计，不是已批准实现或已测可行。若复杂原子内容、窗口下界或原生运动无法达原预算，回本机制/内容粒度，不新增旁路或静默降低UX。

### 8.3 当时的静态自审与待决项（已由§9取代）

| 检查项 | 文档已给出的可审部分 | 未完成/下一证据 |
|---|---|---|
| 范围与状态 | 当时只记录设计审查；设计、技术范围、实现、运行证据四种状态分开 | 该阶段没有生产引擎准入；当前实施状态改读§0与§9.10 |
| 原需求 | 总设计U/B/E/J不删；spec §11.1逐组列齐42、N01–N12、F01–F29、Q01–Q20 | 每ID具名测试与原oracle仍须实施，不用V1–V3替代 |
| 权威与全部位置入口 | 总设计§2/2.1，spec §3.1/3.2定义唯一写者、生命周期、来源和失效 | 静态生产调用图及写入trace未验证 |
| 提交/取消 | 总设计§6.4/6.5，原grant、React阶段、clamp/focus/snap与同点fallback | G1/G2真实浏览器/惯性证据；不得仅方法调用过测 |
| 内容/选择/资源 | 总设计§6.3/6.6，稳定文本点、下界、节点成本、活动保护 | 所有Content类型下界实证、复杂原子块预算、G3/设备选择证据 |
| 系统推进与输入 | W1/W2/W5/W6/W7合同完整，无push同步、全集发现、可靠草稿/IME、32px保留 | 实现符合性、冷扫描成本/实际后端链路；真实不足按BE审批 |
| 复用与删除 | spec §10.1列当前存在路径；R2历史处置表保留 | 批准实施后逐diff核验，旧控制机制同一次入口切换退出 |
| 当前下一步 | 主Agent审完整R3.2提案与自有Engine技术范围 | 获明确范围批准才做spec §2.4隔离样机；不要求用户再次枚举case，不以厂家答复作前置 |

**不能签的结论：** 全部问题已修复、技术选型已经运行可行、完整施工已获准、浏览器/Android已通过。**可提交审查的结论：** 系统责任与行为合同、一个具体几何算法提案、施工复用删除与独立验证计划已落文档；设计Agent请求主Agent审查，不把未通过项包装成完成。


## 9. R3.3生态初筛、独立核验与当前接入决策

### 9.1 研究范围与结论层级

2026-09-17有界初筛覆盖完整聊天组件、通用动态高度列表、headless、滚动容器及成熟消息产品接入，而不是先锁定熟悉的两个库。只读官方资料/源码/issue；没有安装、demo、试用、实验或采购。资料状态会变，以下为本轮版本时点；维护活跃与star不作为能力结论。

撤回“React生态没有合用组件所以必须自研”的无依据推论。当前架构回到ReadingSession意图→唯一公开ListAdapter→成熟组件几何。初筛及三库通用取消比较仍是有效技术资料，但用户随后确认产品没有任意消息定位，故§9.8把通用取消当必选门是过度建模。当前不再横向轮转；以React Virtuoso 4.18.13和Stream实际接入覆盖真实路径，结论见§9.9。Legend/Virtua保留历史对照，不作为无具体失败时的换库或fork理由。

### 9.2 初筛地图与真实使用责任

| 类别/候选 | 版本、许可及维护/来源 | 本任务理由与限制 |
|---|---|---|
| Legend List | 3.3.11，MIT；独立./react；9月11日release。[版本/入口](https://github.com/LegendApp/legend-list/blob/v3.3.11/package.json)、[release](https://github.com/LegendApp/legend-list/releases/tag/v3.3.11)、[Web Chat](https://github.com/LegendApp/legend-list/blob/v3.3.11/example-web/src/examples/ChatExample.tsx)、[Web AI](https://github.com/LegendApp/legend-list/blob/v3.3.11/example-web/src/examples/AiChatExample.tsx) | 稳定key、data/size保位、尾随、dataset生命周期与alwaysRender组合适合；例子覆盖prepend/incoming/长短消息。README仍偏Native、roadmap滞后不等于没DOM；Web长期生产证据尚未建立，不能借Native采用背书 |
| React Virtuoso | 4.18.13，MIT；官方动态高/firstItemIndex/followOutput/缓冲。[API](https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/)、[4.18.13 release](https://github.com/petyosi/react-virtuoso/releases/tag/react-virtuoso%404.18.13) | Stream真实VirtualizedMessageList采用，应用持数据/阅读选择、库负责测量；#1493已修prepend主路径单帧空白。一般issued与已排队follow没有用户输入/props关闭/dataset统一失效边，详§9.8 |
| Virtua | 0.51.3，MIT，9月维护。[API源码](https://github.com/inokawa/virtua/blob/0.51.3/src/react/Virtualizer.tsx)、[Chat例子](https://github.com/inokawa/virtua/blob/0.51.3/stories/react/advanced/Chat.stories.tsx) | shift服务首部增删，官方提示中尾变化应关；keepMounted支持交互保留，变高内部测量。内部有waiting cancel闭包但未公开且普通输入不调用；#968/#595印证该边仍缺，详§9.8 |
| TanStack Virtual | MIT；官方已有chat/end-anchor/follow能力，[API](https://tanstack.com/virtual/latest/docs/api/virtualizer) | headless责任更多；本地已知接入/guard反例保留，不从有限失败推断永远不可用。禁no-op压私有状态假装纯计算 |
| react-window | MIT，v2有dynamic useDynamicRowHeight/rowKey，[源码/文档](https://github.com/bvaughn/react-window) | 不能沿用“仅固定高”旧印象；聊天mixed/follow/交互需较多应用接线，本轮不优先 |
| react-virtualized | MIT，CellMeasurer/List，[仓库](https://github.com/bvaughn/react-virtualized) | 需更多手工测量失效/缓存协作；与当前减少自维护控制目标不如前三匹配 |
| Chatscope Chat UI Kit | MIT，[MessageList源码](https://github.com/chatscope/chat-ui-kit-react/blob/master/src/components/MessageList/MessageList.jsx) | 是完整聊天外观/滚动管理，不是长历史虚拟化替换；自己的snapshot/resize定位不可再叠另一个主动列表 |
| react-scroll-to-bottom | MIT，[仓库](https://github.com/compulim/react-scroll-to-bottom) | 跟随滚动容器不是虚拟列表；叠其控制与动态高列表会复现多writer |
| Element Web ScrollPanel | 成熟真实聊天方案；AGPL/GPL或商业，非MIT可无条件移植。[源码](https://github.com/element-hq/element-web/blob/develop/apps/web/src/components/structures/ScrollPanel.tsx) | 稳定scroll token+可见项偏移、fill/unfill与应用耦合；是产品实践参考，不是现成独立React替换包。旧matrix-react-sdk已迁移，不能读归档当现状 |
| 官方Virtuoso MessageList | 商业；公开data+scrollModifier、mapWithAnchor/replace(anchor)，详§7.5 | 行级mixed机制实质存在，不只是prepend；商业批准独立。本轮不以购买/试用为前提，也不因DataAnchor不懂文本推出必须手写引擎 |

真实采用证据：[Stream官方组件说明](https://getstream.io/chat/docs/sdk/react/components/core-components/virtualized-list/)、[接入源码](https://github.com/GetStream/stream-chat-react/blob/master/src/components/MessageList/VirtualizedMessageList.tsx)。其Channel数据、suppressAutoscroll、followOutput、稳定key和prepend配对是责任协作例证；own-send强跟随/可选focus跳尾不照搬，不采用其后端/整个SDK。官方Chat例子是可用方式证据，不冒称生产性能验收。

### 9.3 主Agent独立README/issue/源码核验（本轮事实，不做数量投票）

| 证据 | 当前准确解释 |
|---|---|
| Legend [#537](https://github.com/LegendApp/legend-list/issues/537) | open issue内有3.3.10 Electron复现和react.mjs修补；主Agent读3.3.11 [ScrollAdjust](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/components/ScrollAdjust.tsx) 101–105确认写后读DOM序列化值，release也列padding修正。归已修已知风险，不宣称新版仍漏 |
| Legend [#448](https://github.com/LegendApp/legend-list/issues/448)、[#525](https://github.com/LegendApp/legend-list/issues/525) | Web刷新空白仍open且维护者需repro，无精确新版复现；3.3.5尾随报告与3.3.11修复重合。列C5/C1回归，不认定新版必现 |
| Virtuoso [#1373](https://github.com/petyosi/react-virtuoso/issues/1373)、[#1405](https://github.com/petyosi/react-virtuoso/issues/1405) | 前者closed，维护者建议skipAnimationFrameInResizeObserver；后者open限定首次用户滚动前+Header LoadMore。撤回泛化“所有prepend必败/升级必无效”，历史本地失败另保留，不改写 |
| Virtuoso [4.18.13/#1493](https://github.com/petyosi/react-virtuoso/releases/tag/react-virtuoso%404.18.13) | release明确修复prepend旧页时一帧空白：deviation到DOM后由renderer layout effect确认，同一paint执行补偿；若下一帧仍无确认则保留旧fallback。它纠正“4.18.13无相关修复”的旧判断，但只关闭该主路径缺陷，不证明全部C3，更不提供C1取消 |
| Virtua [#636](https://github.com/inokawa/virtua/issues/636)、[#968](https://github.com/inokawa/virtua/issues/968) | #636已closed，维护者称可能0.51.0修复，若仍有应reopen；#968 imperative cancellation仍open。旧搜索open不是现版事实，缺cancel提议也不是整个聊天不可用 |
| TanStack [#1258](https://github.com/TanStack/virtual/issues/1258) | 已closed、无comments，本轮未查明确修复版本；不能当现版确定未修。官方chat/end-anchor能力存在 |

### 9.4 Legend公开协作与具体门槛（历史候选审查）

[base types](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/types.base.ts)、[Web types](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/types.web.ts)确立：data/keyExtractor/dataKey、maintainVisibleContentPosition的data/size、maintainScrollAtEnd、alwaysRender.keys/indices、recycleItems、drawDistance、公开导航Promise与观测。

单控制权图：用户→ReadingSession（唯一mode/nav/bookmark）→Adapter（同次data/props+一次明确命令）→Legend（唯一测量/range/回收/scroll）。Replica/Presentation/Content不创建导航；Selection owner只把活动keys与暂停跟随条件交Adapter。组件内部几何状态不等于应用第二阅读模式；Adapter也不成为另一滚动引擎。

| 任务 | 已知公共机制 | 未关闭/禁止伪解 |
|---|---|---|
| 用户滚离尾部取消自动尾随 | 3.3.11 release明确维护到尾与用户离开/新目标停止 | 不等于一般issued导航接管已验证 |
| 一般显式导航 | scrollToIndex/Item/End等Promise；dataset改变取消旧请求；内部ready等待/token可只读见源码 | C1必须覆盖同频道issued后各真实输入、晚resize及新授权；不能读当前offset再发新导航冒充取消，不能behavior guard |
| mixed保位 | 不可变data+稳定key+maintainVisibleContentPosition={data:true,size:true} | C3冷未知高度/删除fallback、C5首paint与快反向待证；不自造spacer/尺寸树 |
| 内容/流式 | 应用稳定块、局部解析、Choices、媒体壳；组件测量项变化 | 行顶不是整条长文文本点；当前块内改写实际reflow与未改写块间保位分开，D01保留 |
| selection/focus | alwaysRender.keys保活；初始recycleItems=false；稳定DOM节点 | pin只解决回收，不解决Content重建选择节点；B08/C2真实复制/焦点/反向+mixed验证 |

主Agent独立核验不等于C门运行通过。Legend Web成熟度是该历史候选的残留风险，不声称成熟最好。一般issued取消的源码结论仅保留为候选比较事实；当前产品门和固定候选以§9.9为准，仍禁止用应用第二控制路径抵消真实失败。

### 9.5 需求校准与完整范围

用户明确：浏览不被同步拉走、底部才跟随、快滚不空白、长文/历史稳定、进入无push主动同步、任务后端证据、可靠输入、状态不改几何、32px/移动目录；全部不变。合理推导：稳定语义块、Choices外存、观测实际阅读段落/文本点、用户接管回底/尾随及选择节点连续性；不再推导一般目标导航。

撤回的是我们从“任意全文改写/任意UA重排下所有字符每帧都≤1px”推导必须自研的过度要求，不是假称原总设计完全没有物理可行域。准确oracle为**指定的未改写存活阅读锚点**在物理可行/无自身重流条件下≤1px；宽度/字体/当前段落改写另验同一语义阅读位置/存活fallback。普通prepend/live/cache导致前方增加仍必须保位，不能借reflow开脱。D01/B08、正常实时更新、不冻结正文均保留。

原U/B/E/J、42条、N01–N12、F01–F29、Q01–Q20映射与W1–W8继续主设计/spec原位置；V1–V4不是替代。Task集合发现、无下一push义务、IME/草稿/Outbox、Surface/移动/后端审批没有因选型变更缩减。

### 9.6 实际设计动作、自审与下一步

主Agent要求先更新磁盘而非等全文；设计Agent已用apply_patch替换主设计/spec的自有Engine算法/接口，并先撤回本账顶部旧指令。随后加入本节初筛/独立核验与取消区别，更新T2/下一步，§7/8保留历史并明确失效。未修改运行代码、依赖、后端、服务；未安装/实验/构建/测试/分支操作，未清理用户现有修改。

| 审查面 | 当前设计可审内容 | 不可签结论 |
|---|---|---|
| 单一权威/所有位置入口 | 主设计§2/2.1；意图/内容/Adapter/组件分离，spec§3公开映射 | 不能凭一个API入口声称库每次写入已有撤销保障 |
| 状态/并发/生命周期 | 原activation/input/content/layout、A→B→A、0size、mixed保持 | C1issued及C3真实提交证据未完成 |
| 内容/选择/性能 | 稳定单元、增量更新、活动keys、节点成本、准确文本oracle | C2/C4/C5非类型定义已证，不能只测消息顶 |
| 系统完整性/迁移 | 原W1–W8、全部场景/复用删除保持；退出guard/settle/外补偿，未新建Engine | 系统实现、任务全集成本、浏览器/Android均未通过 |
| 技术结论 | 组件执行方向成立；通用导航取消不是当前产品门，按Stream分工优先核验Virtuoso 4.18.13公开接入 | Stream采用/#1493不等于本项目C1–C5或生产准入已通过 |

该阶段下一步由主Agent审三文档与§9.9的真实路径裁决。尚未获准实现；fork/vendor明确未批准。**不创建独立demo、不要求商业试用、不默认自研、不再轮转库、不让用户继续当第一道测试。** 失败按设计缺口/违约实现/组件能力/边界bug分责处理；任何后端变更仍逐项明确批准。

### 9.7 Legend 3.3.11：issued导航与尾随关闭的定向因果核验（历史证据，不是当前产品门）

范围仅该tag的公开types、Web输入、ready/token、定位/完成与fresh dataset直接调用链。只读远端源码，没有实验或安装。以下“成立”指所列条件下存在实现边，不冒充浏览器UX通过；“缺边”指精确路径不取消，不等于所有用法都失败。前节一般C1未知进一步收敛如下。

源码索引：S1 [createImperativeHandle](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/utils/createImperativeHandle.ts)，S2 [scrollRequestTracker](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/core/scrollRequestTracker.ts)，S3 [Web输入](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/components/ListComponentScrollView.tsx)，S4 [doMaintain/interrupt/finish](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/core/doMaintainScrollAtEnd.ts)，S5 [updateScroll](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/core/updateScroll.ts)，S6 [LegendList](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/components/LegendList.tsx)，S7 [fresh transition](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/core/initialScrollLifecycle.ts)，S8 [cancelImperativeScroll](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/core/cancelImperativeScroll.ts)，S9 [Web doScrollTo](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/core/doScrollTo.ts)，S10 [finishScrollTo](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/core/finishScrollTo.ts)，S11 [ScrollAdjustHandler](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/core/ScrollAdjustHandler.ts)，S12 [MVCP](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/core/mvcp.ts)。Web在[ListComponent](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/components/ListComponent.tsx)198–202不接Native onScrollBeginDrag。

| 操作/阶段及输入 | 实际因果路径 | 结论、反例及归属 |
|---|---|---|
| Index/Item：waiting，animated=false/true均同 | S1 start→supersedeInitial→runWhenReady；data/MVCP未稳或目标尺寸未就绪时每帧仅查S2 token，2稳定帧或800ms后run。Item在run时查引用对应index；Index带原index | Web wheel/touch/key/拖条没有通用边使token失效。用户接管后即使ReadingSession取消，只要无新库请求/fresh清理，旧run仍合法执行。**取消机制缺边已确认**，等待窗口实际出现/可见结果另验 |
| End：pending commit/ready，auto/smooth均同 | S1保存pendingScrollToEnd及token；S6 layout effect消费，再走同一ready链，运行时算最新尾部 | 不是维持尾随状态本身，单凭用户输入/false不会清pending。即使请求目的是回最新，用户后来向上仍必须能接管；当前缺同一取消边 |
| 一般非尾随Index/Item/End：active auto | S9向DOM写一次auto，保存targetToken，100ms后finish；S5遇scrollingTo不将scroll视为用户手势；S12可按scrollingTo.index保位 | **不能说auto持续轮询重写**。但输入没有立即清旧目标；100ms间尺寸/数据MVCP仍可能围绕旧目标。确切可见偏移待运行，执行期取消边缺失不是未知 |
| 一般非尾随Index/Item/End：active smooth | S9调用browser smooth，监听scroll/scrollend/idle/max；这些只检测/清理完成监听。S10 finish时可能S11 commitPendingAdjust按旧index重新算位置 | 浏览器是否因wheel/touch/key/拖条停动画由UA/输入决定，须实测；库无四类输入的通用目标取消。若期间有pending size adjust，原目标仍参与完成调整；不能以浏览器可能停动画证明完整C1 |
| 尾随pending或active：Web向上wheel | S3检查delta<0、非ctrl、未preventDefault、有maintaining/pending；S4 interrupt在active instant/animated或相应end目标时→S8清任务；finish清尾随。active时S3内部向当前实际offset auto写以停止browser动画，不吞手势 | **限定机制成立**；这是库内部明确处理，不授权应用复制“当前offset新导航”假取消。pending时清状态使S4旧RAF检查失败；不涵盖一般非尾随导航 |
| 尾随：Web touch/key/拖条 | Web不接Native beginDrag。若实际scroll向上、scrollingTo为空、无adjust/nativeMVCP，S5 isUserScrollEvent→finishMaintain；若有active scrollingTo则判据为false | 无active目标的实际向上运动可终止queued follow；尚无运动、active smooth/instant时不能借Native路径保证。浏览器触摸惯性/键盘/拖条动画结果待测，但缺active通用取消边已知 |
| 任意模式：maintainScrollAtEnd由true改false | S6只更新state.props，没有该prop变更专用cleanup；未来S4调用会因false走finish。已排队S4 RAF捕获原config，只检查维护状态/阈值/位置/其他任务，不重读prop | **false≠即时取消已排队/active导航**。反例：queued RAF→选择/接管关闭props但无实际位移→RAF仍按旧config启动。无需借新data触发；时间窗可见性待验。ReadingSession→props撤销交接缺边 |
| 真正dataKey转换到新非空dataset | S6已有非空历史且数据变化、(key变或前数据空)、新data非空→fresh epoch；layout effect→S7 didStartFreshData→S8 cancel+清maintaining/pending | **库JS任务清理路径成立**；不是任意dataKey变化都立即取消（新空数据条件不同）。S8取消scheduled ready/completion、清target/pin/resolve，但不发DOM stop-smooth；UA残留动画跨dataset的可见性另验 |
| 新明确请求 / 卸载 | S2 start递增token、取消旧ready/settle旧Promise；实际scrollTo替换target并取消旧completion。卸载S6→S8+scheduledWork.dispose | 新真实目标及卸载有失效机制，不是用户接管API。禁止伪dataKey/remount清旧工作、禁止以旧offset包装新请求，二者会破坏阅读/选择或制造迟到定位 |

**props交接的三层结论：** ReadingSession同步撤销原grant并拒绝旧完成是应用模型可保证的；Adapter在应用提交/发出前检查授权是应用实现义务；库已收工作的停止依赖上表实际机制。当前不能靠currentGrant、每render传false或应用token宣称第三层已成立。主设计§5和spec CommitPort注释已据此修正。

**可裁决结论：** Legend 3.3.11原公开接入不能签本项目完整C1；缺的是同频道一般waiting/active导航的用户接管，以及关闭follow prop与旧工作失效的交接。现有公开API未提供满足这些边的合法取消方式；“提前准备好再发”能缩小ready窗口，不能排除合法并发尺寸/用户接管。普通回归只能验证后果，不能生成缺失机制。候选保位/物化/选择等有用能力继续保留，不从该缺口推导必须自研或整个生态不行。

**当时的下一机制裁决**曾由§9.8收敛为评估Legend最小生命周期修订；该行动已被§9.9撤回，不再等待或实施。这里仅保留源码因果证据。本轮不实现补丁、不提交上游消息、不购买/安装/实验，也不擅自fork。C2–C5仍是各自回归门，真实系统模型/42+N与全部既有UX不变。

### 9.8 三候选通用取消核验（事实保留；原条件选型已由§9.9撤回）

范围只包括§9.1限定的三个当前发布版及已经发布的相关修复；没有继续泛搜生态。核验采用同一问题：**waiting、active auto、active smooth、自动尾随已排队、props关闭、dataset转为非空/空时，原执行如何失效？** “新命令覆盖旧命令”、卸载或浏览器偶尔中断动画不等于用户接管合同。

| 候选 | waiting / active用户接管 | props关闭 | dataset非空 / 空 | 裁决 |
|---|---|---|---|---|
| Legend 3.3.11 | waiting只检查内部request token；Web wheel/touch/key/拖条不统一递增。active auto虽只写一次，但100ms内旧target仍供MVCP；active smooth及pending adjust仍持旧目标。尾随向上wheel有专用interrupt，但不覆盖一般导航 | `maintainScrollAtEnd=false`只更新props；已排队RAF捕获旧config，pending/active不即时清理 | fresh转换到新**非空**dataset会走`cancelImperativeScroll`清JS任务；新空集不走同一条件，且已启动smooth没有DOM stop | 对当时“通用C1”不准入；已有中央token、cancel和fresh清理使修订面较集中。该门已非当前产品门 |
| React Virtuoso 4.18.13 | [scrollToIndexSystem](https://github.com/petyosi/react-virtuoso/blob/react-virtuoso%404.18.13/packages/react-virtuoso/src/scrollToIndexSystem.ts)的auto在DOM写入后观察`listRefresh`约150ms，变化则重发原location；smooth等`smoothScrollTargetReached`后如有变化也重发，每次尝试另有约1200ms安全cleanup。Web滚动输入只更新scroll state，没有取消该订阅/目标的公开入口 | [followOutputSystem](https://github.com/petyosi/react-virtuoso/blob/react-virtuoso%404.18.13/packages/react-virtuoso/src/followOutputSystem.ts)把动态高度follow登记到下一次`listRefresh`，固定高度分支排rAF；prop变false不清既有handle/rAF | `data`/`firstItemIndex`没有独立dataset执行token；无论替换为非空或清空，都没有按dataset identity清旧location，若变化触发`listRefresh`还可按旧目标重试。新命令会cleanup旧监听，卸载会销毁system，但都不是接管 | #1493同paint prepend修复保留为C3优势；当时“通用C1”缺边事实保留，但§9.9证明不能据此要求补丁 |
| Virtua 0.51.3 | [observer](https://github.com/inokawa/virtua/blob/0.51.3/src/core/observer.ts)内部`cancelScroll`可停止waiting测量订阅，但只由下一命令或特定shift jump调用，普通wheel/touch/scroll/key不调用且公开handle无cancel。auto可在每次测量后重写至最后一次测量后150ms；smooth在测量完成后即`stop()`内部监听再交给浏览器，组件不再持可取消active阶段 | `shift=false`只影响后续`ACTION_ITEMS_LENGTH_CHANGE`，不是自动尾随关闭，也不清imperative waiting/active；chat例子的stick属于应用策略 | 没有dataKey/dataset token。首部长度变化且`shift=true`产生实际jump时，`_fixScrollJump`会取消waiting；普通非空替换、mixed、清空或无jump不能依赖该路径 | [#968](https://github.com/inokawa/virtua/issues/968)仍open，[#595](https://github.com/inokawa/virtua/pull/595)导出cancel仍未合入；对当时“通用C1”不准入，且follow需更多应用策略；非当前候选 |

**已撤回的条件选型：** 本节曾据三库缺通用取消而条件选择Legend源码修订。用户随后确认没有任意消息/引用/search定位；该结论没有先证明一般Index/Item路径在真实产品可达，故不足以支持fork/vendor。下列最小修订只保留为“若未来真实路径复现且公共接入无法解决时”的成本资料，不是当前W0前置或施工范围。

最小组件内部修订合同如下；这是供主Agent审批的范围，不是已实现方案：

1. 单一`executionEpoch`覆盖Index/Item/End、maintain-at-end及其ready/completion/adjust。每个延迟边在写DOM前检查原epoch；失效只settle原Promise为cancelled，不借新授权重发。
2. 公共handle增加真正的`cancelScroll`（或等价受支持入口）。Adapter在已归属主列表的wheel/touch/键盘/拖条接管时同步调用；组件内部清waiting token、pending end、maintaining、target/pin、completion和pending adjust。不得读取current offset再包装成新导航。
3. Web active smooth取消须在组件内部停止浏览器动画于当下实际位置并清旧目标；active auto不需要伪造第二次定位，但必须立即清MVCP/完成链对旧target的引用。接管事件本身仍交浏览器原生处理，不preventDefault。
4. `maintainScrollAtEnd`从有效授权变false时，同一提交生命周期使全部旧follow工作失效；旧RAF不得捕获配置继续启动。只取消follow不误杀无关的新显式导航。
5. 真正`dataKey`变化无条件使旧dataset执行失效，旧/新数据为空或非空语义相同；它不作为同频道接管技巧，也不remount Content。卸载继续是最后资源清理。

预计维护面是**一个组件内部生命周期补强，而非列表引擎**：围绕request tracker/cancel、imperative handle与类型、Web scroll执行、follow prop转换、fresh dataset转换及定向DOM测试，约6–8个实现/类型文件加测试；不改测高、range、回收、MVCP算法，不新增应用尺寸树。成本为中等且持续：每次上游升级需rebase这一条生命周期、检查Web smooth跨浏览器语义并重跑C1/C3；若要以fork/vendor承载、提交上游或长期冻结版本，均需主Agent/用户另行授权。本轮没有执行这些动作。

该历史方案不再进入通过顺序。当前验证顺序见§9.9；#1493作为Virtuoso已发布修复保留。

### 9.9 真实需求→Stream生产路径→必要能力反证审查

用户确认现有产品只有**原生阅读、触顶历史、append/prepend/内容resize、点击回到底部、进入/返回/切频道的实际初始化/阅读恢复**；没有跳到某条消息、引用点击定位或search target navigation。旧U09及由`navigationTarget`推导的一般Index/Item生命周期属于误建模，必须从当前门槛和生产入口删除。恢复是activation初始化策略，不自动等于挂载后任意imperative导航。

主要证据为Stream官方[VirtualizedMessageList源码](https://github.com/GetStream/stream-chat-react/blob/master/src/components/MessageList/VirtualizedMessageList.tsx)及其[消息集key](https://github.com/GetStream/stream-chat-react/blob/master/src/components/MessageList/hooks/VirtualizedMessageList/useMessageSetKey.ts)、[prepend计数](https://github.com/GetStream/stream-chat-react/blob/master/src/components/MessageList/hooks/VirtualizedMessageList/usePrependMessagesCount.ts)。Stream当前源码依赖Virtuoso 2.x API形态，故它证明成熟的责任分工和长期真实聊天采用，不单独证明4.18.13的每个实现细节；本项目候选仍固定React Virtuoso 4.18.13，并单独采用#1493发布证据。

| 真实需求 | Stream / Virtuoso公开生产路径 | Atoll最小接入与仍需证明 |
|---|---|---|
| 初次进入 | `initialTopMostItemIndex`在首次组件生命周期选择末项；已有highlight分支不是Atoll需求 | 新会话following用末项；已保存browsing书签在挂载前解析为初始index/公开restore输入。缓存晚到只更新data，不二次恢复；若书签数据尚未取得，先由数据义务解决，不发虚构目标导航 |
| 返回/真正频道切换 | Stream对不连续message set更新`key`并重新计算initial；连续prepend不会重挂 | channel/view activation或确认不连续数据集可合法新组件生命周期；这是身份边界，不是同频道用户接管伪remount。A→B→A各自从ReadingSession书签初始化 |
| 触顶历史/prepend | 精确维护`firstItemIndex`和稳定`computeItemKey`，数据与prepend计数同次更新 | Adapter映射真实新增前缀；无restore/scrollBy。4.18.13 #1493把常规prepend deviation确认与补偿合到同paint，fallback仍纳入C3逐帧回归 |
| 普通append | `followOutput`只在满足策略时使用`auto/smooth`，否则false；浏览中显示新消息提示 | Atoll按本次ReadingSession原子提交稳定following策略`() => 'auto'`或字面量`false`，不复制Stream“自己发送即强制回底”。append不创建应用导航或完成任务 |
| 流式/图片/字体resize | Virtuoso ResizeObserver和upward fix公开机制 | Atoll只让组件自身测量/保位；Content不持列表ref、不发`autoscrollToBottom`，Adapter也不因resize另发命令。C3/C4实测文本点和首paint |
| 点击回底 | Stream在已有最新数据时一次`scrollToIndex(last)`；若尚有newer先获取最新集合 | Atoll不照搬该调用：唯一imperative入口`jumpToLatest()`先确保latest，再一次公开`scrollTo({top: 当刻scrollHeight, behavior:'auto'})`并设following；无缓存、重试或动画降级 |
| 用户继续向上 | Virtuoso原生滚动更新atBottom；Stream没有通用cancel，也没有为普通聊天fork | 真实门只问：回底或append follow已pending/active时，wheel/touch/key/拖条向上并叠resize，是否会再次拉回底。先用4.18.13公共接入定向验证；未复现不能从一般cancel缺口推fork，复现后才按具体阶段评估受支持修正 |
| 选择/焦点/快反向 | Stream稳定message key和虚拟窗口是采用证据，但没有证明Atoll的跨项选择/焦点预算 | C2/C5继续是运行门；不能因Stream采用自动签过，也不能先假定需要组件源码修改 |

Stream的业务默认不照搬：`shouldForceScrollToBottom`会让自己的新消息即使用户离尾也回底，`scrollToLatestMessageOnFocus`可在窗口focus后定时回底，highlighted message effect会定位消息；Atoll当前产品没有这三项授权，全部关闭/不接入。这样删的是SDK产品策略，不是删Atoll已有UX。

**当前最小可行判断：** fork必要性不成立。React Virtuoso 4.18.13公共接入覆盖所有已确认的结构路径；通用cancel缺失只是源码事实，不是脱离可达操作的否决票。正常接入获准后最早只跑一条真实止损轨迹：在异构动态高列表底部触发append尾随或点击回底，立即以wheel/touch/key/拖条向上，同时注入最后项resize，逐可观测帧检查用户运动不被后续拉回。若通过，移除fork门继续C2–C5；若失败，保存最小轨迹并只针对该follow/bottom阶段决定应用接入bug、上游已支持配置或组件缺口，不能自动恢复§9.8的全局epoch/fork方案。可实施合同已经关闭；“4.18.13在Atoll生产链实际通过”仍必须由实施与运行证据回答。

### 9.10 已批准施工后的当前实现、失败总账与C1范围卡

主Agent在核对§9.9后批准当前r3工作树进入完整前端实施；授权包含固定公开依赖、生产接线、旧链删除、相关测试及集中review，不包含后端/协议/服务/部署、fork/vendor或修改`node_modules`。当前HEAD仍是`193f189cd3ae63cf3deb9e54d71d7bbeb9fd304c`，证据针对未提交工作树；未提交差异不冒称提交或发布物。

已形成的生产链为`Replica/SyncSession/HistoryDemand → immutable Presentation → ReadingSession → MessageList → React Virtuoso 4.18.13 → stable Content/Choices`。旧`conversation-viewport`、`history-interaction`、`measured-layout`、`VirtualTimelineAdapter`及`useConversationViewport`运行路径已退出；没有`pendingContentAnchor`、`commitBookmark`像素补偿、settle重试、scroll-authority guard、多个follow ref或history/resize完成后的恢复滚动。`data`与`firstItemIndex`同次提交；browsing传字面量`false`，following才传策略；Content不持列表ref、不在高度变化时调用`autoscrollToBottom`。唯一回底在当前activation、latest数据已证实后，用公开`scrollTo({top: 当前scrollHeight, behavior:'auto'})`执行一次；scrollHeight只在执行当刻读取，不缓存、不重试。

实施中已关闭的具体反例：

- native input的source/geometry证据在事件边界保存，layout变化不能继承旧`user`来源而授予following；拖条先以browse接管，再由真实主scroller位移给出方向。嵌套代码块自行可滚时不改变主阅读意图。
- activation生命周期保存只读取该activation在React **commit阶段**发布的owner与最后提交rows；render中不再写这些refs，aborted/suspended render不能污染旧cleanup。cleanup捕获旧node，不以`isConnected`或新ref判断所有权。频道、scope/filter和access出口走同一保存路径。
- 恢复保留同一存活消息的row/text offset；目标删除时只选明确successor/predecessor/seq语义位置，不把已删除长行的负offset套给替代项。500ms只是一项presentation初始化预算：到期展示live并保留书签供下次activation，不让迟到history再抢当前阅读。
- 发送frame在第一次尝试前把origin固化进Outbox；重连不再用同一message ID从`s-mock-1`重盖为`s-mock-2`。lost receipt的catch只以同principal/channel/message及当前submission身份查询Replica `_envelopesById`，不用local echo作durable fact；删除使用既有IDB事务/CAS，不能删掉后来的重试或编辑记录。unknown权限保持queued；attach成员快照推进directory access version后重试effect重新读取member，避免永远不发送。
- F6全局测试不再裁`data.slice(-64)`或重写`firstItemIndex/initialTopMostItemIndex`。`PresentationMessageList`的64项窗口只供不验证虚拟化/分页/恢复的正文语义单测；100k账本DOM预算、冷prepend/快反向及阅读窗口均迁至生产`MessageList`浏览器路径。合成pointer+写scrollTop已明确降级为合成输入模型，原生thumb另用headful mouse轨迹，不冒充同一种证据。

协议/UX纠错不是删覆盖：C只使用实际manifest公开的`actor.describe`、`agent.interrupt`和`human.approve`（decision闭集approve/reject，可选note），不伪造`agent.restart/terminate`；成员restart/delete属于D的`system.member.*`。E的Actor/频道模板create/edit/delete逐步断言对应request payload并重新list/get核对终态字段，不以requestID变化或泛化“完成”替代字段；`system.channel.set`不接受endpoint，endpoint只来自既有channel create `recipe.profile`。定时事件在`@我`过滤外，测试通过真实scope切换查看；上下文overlay遮挡时走可达关闭入口，不force click或强制拉底。

#### 9.10.1 初次25失败与当前复验账

纠正全局Virtuoso假裁剪后，首轮完整浏览器运行是**117 passed / 25 failed / 2 skipped**。这25项原始失败与trace保留；它们不是一个“库不行”结论，实际分为生产缺陷（阅读owner、恢复fallback、Outbox origin/CAS、权限活性）、旧协议/UX oracle（C/D/E字段和可达入口）、失真测试（F6裁剪、合成拖条名称）及真实组件交接C1。没有整体归为jsdom，也没有靠删场景、force click、延长sleep或放宽最终offset刷绿。

当前同一工作树的可复验结果：

| 分组 | 当前结果 | 证据含义 |
|---|---:|---|
| wire/outbox/mock B定向 | 3 files / 22 tests passed | immutable origin、事务/CAS与fault按真实msg type注入 |
| B-BR-07/07a | 2/2 passed | feed先落时不回退；receipt与feed均未确认时真实出现uncertain，随后重连按账本收敛；并硬断言无`idempotency_conflict` |
| MessageList commit owner + access活性 + reading接线 | 3 files / 5 tests passed | suspended render不取得旧cleanup；unknown→member version推进后自动发送 |
| Phase B/C/D/E完整分组 | 41/41 passed（单worker，3.1m） | 含上述真实协议字段、CRUD终态、receipt顺序、权限与可达入口；不是仅focused grep |
| F7频道/scope/filter/access出口 | 3/3 passed（commit-owner修正后重跑） | 同一activation cleanup保存并按原row offset恢复；access轨迹使用可撤销的`c0.project`而非受保护root |
| 完整Vitest | 118 files / 646 tests passed（14.12s） | 在上述owner修正及测试基础纠偏后冻结运行；jsdom提示Canvas未实现，但无失败/skip |
| Vite production build | passed（4357 modules，2.74s） | 产物可构建；保留大chunk警告，不复制dist、不部署、不把build当UX验收 |

以上只结清对应25失败族的当前反例，不代表完整suite、全部F/Q/J、build、Android或C1通过。此前运行中改源码的结果不作最终验收；下一步必须在源码冻结后跑全量unit、完整browser/行为fuzz和build，并逐项记录skip/环境限制。

#### 9.10.2 C1当前真实失败与待授权的最小依赖范围

公共接入已先纠正两项自身错误：browsing向Virtuoso传**字面量false**而不是“总存在但返回false的函数”；删除`totalListHeightChanged → autoscrollToBottom()`，因为该调用会自行登记约100ms的SIZE_INCREASED授权。第一次following→用户接管用同一native input turn提交当前prop；没有增加时间阈值、DOM反向补偿或新控制器。纠正后仍有两条独立失败：

1. 标准append+wheel+resize：follow输出在561.2ms发起scrollTo，wheel 608.8ms，takeControl 609.3ms，literal false于612.1ms提交、615.4ms完成；651.9ms晚高度变化后，组件内部652.0ms按原index retry，652.8ms再次scrollTo。来源是follow已进入`scrollToIndex`后的size retry，不是本项目resize callback。
2. 无append对照：wheel 568.2ms，false 571.5ms，接管574.8ms完成；575.9ms旧SIZE_INCREASED订阅触发“scrolling to bottom”，577.1ms再次scrollTo。无resize对照通过。标准与隔离trace分别保存在`test-results/c1-timeline`和`test-results/c1-debug-public`，原失败未skip或放宽。

因此当前没有诚实的**纯公共API**修正可以关闭这两条：prop变false能阻止新授权，不能注销已进入`scrollToIndex`的尺寸retry或既有follow size订阅；发新current-offset命令、remount、冻结data、禁输入、DOM写scrollTop或应用补偿均违反当前合同。另一方面，这个结论只针对真实append-follow接管，不恢复任意Index/Item通用cancel要求：初始恢复仍是挂载输入，用户回底仍是一次同步公开绝对scroll，二者不能被follow取消误杀。

若用户另行授权依赖修订，最小范围是Virtuoso内部为**follow-origin**生成的pending `scrollToIndex`任务及follow的`I/a` SIZE_INCREASED订阅建立同一失效边：当prop从授权策略提交为literal false时，只清这些旧follow工作；不取消initial初始化、不取消Atoll明确回底、不改测高/range/回收/prepend算法。需要覆盖followOutputSystem、scrollToIndex任务来源/cleanup及定向DOM测试，维护成本为每次4.18.x升级重核这条内部连接与C1轨迹。注销`I/a`单点不足以处理已进入index retry，故不能把更小补丁写成闭合方案。**此依赖范围尚未授权，当前不实现、不fork、不改node_modules；C1保持明确未通过，而其余owner验证继续。**

#### 9.10.3 首轮完整浏览器、公共接入再收敛与剩余失败

首轮冻结完整浏览器是**131 passed / 15 failed / 2 skipped**（Chromium，单worker，约9.5m，`test-results/full-browser-final-1`）。15项为：composer多行几何、following append首paint、数学布局节点、折叠保位、连续prepend、频道返回恢复、审批reload、浏览中尾行内容增长、C1标准/无append，以及5项视觉基线。后续定向通过不能追溯把这轮改写为通过；视觉基线没有自动更新。

本轮已按责任层继续收敛：

- 数学失败取到了已经脱离DOM的旧节点；等待durable PONG后读取当前connected布局节点通过。折叠正文建立`flow-root`，消除展开/收起margin-collapse语义差；这没有关闭下述真实动态高度时序。
- 恢复失败的trace显示保存目标`c0-history-request-106`已正确位于-96px，随后组件初始零窗口无用户输入却触发`startReached`，拉取并prepend 78–105覆盖声明式初始化。现在browsing历史请求只在真实主scroller向上用户运动到顶的事件边界发出；不足一屏需求不再使用`startReached`或following/noBookmark替代，而要求非零viewport、数据首尾都已物化、实际内容高度不足且`hasOlder`仍真后才发。连续prepend+频道返回组合复验2/2通过，没有恢复命令或外部补偿。
- following过去始终传函数，browsing也只让该函数迟读返回false；这会让resize路径仍把prop视为授权。先改成following字面量`'auto'`、browsing字面量`false`后，原following append逐帧轨迹3/3通过，但新增意图/几何脱节反例显示：session仍following、无用户输入而几何暂离尾160px时，append后gap稳定679px，字面量auto没有消费该业务意图。最终公共接入为following传模块级稳定`() => 'auto'`、browsing传字面量`false`；同一反例转为通过，并另验browsing虽被布局夹到几何尾部仍不会跟随append。这既不读迟到ref，也不是新scroll writer。
- `skipAnimationFrameInResizeObserver`公共开关曾使连续prepend定向3/3通过，但产生大量`ResizeObserver loop completed with undelivered notifications`未处理错误；去掉该开关并修正真实HistoryDemand来源后，continuous/restore仍2/2通过且不再有该错误，故当前生产接入保持默认RO调度，不屏蔽console。
- HistoryDemand不再信任初始edge：只有已提交非零viewport、数据首尾都已物化且物理内容不足时发欠供给；连续向上、underfill、频道恢复组合3/3通过。Chromium Home轨迹为keydown/keyup后多次scroll，`scrollend`先在真实0px到达、最后scroll事件才发；现在只在同activation/inputEpoch的active older输入且`scrollend`实际`scrollTop<=1`时发需求，Home定向通过。返回初始化出现可读行后立即真实wheel、下一帧原子data+firstItemIndex prepend的组合也通过：ReadingSession保持browsing，旧书签没有重夺视窗。真实触摸/OS惯性仍需Android设备，不能由Playwright wheel冒充。

仍未关闭的真实几何失败：浏览中尾行内容增加稳定把同一锚点从-64移到-92（28px）；帧证据为row高度不变1976，`scrollHeight/maxScrollTop/scrollTop`同时从19268/18668/17188变为19296/18696/17216。只读运行时调用栈确认该+28来自Virtuoso现有upward resize fix发出的`scrollBy({top:28, behavior:'auto'})`，不是Atoll回底入口或浏览器自然夹限；诊断注入已撤下，固定轨迹保存在`test-results/tail-revise-source-2`。这把责任定位到库的resize判定，但当前未获size范围授权，不能把它并入§9.10.2两system请求或自行补偿。折叠动态高度在默认RO路径也仍失败：最新单轨迹中按钮412.34375→413.40625（+1.0625），高度恒26；同一row从top -1686/height 2272.4375变为top 48.03125/height 539.09375，再变top 48.40625；scroller从`scrollTop=4774=maxScrollTop`变为3041/3042，随后`scrollHeight`再舍入增加1令max变3043而scrollTop仍3041，DPR=1。按钮位移与row top位移一致，误差伴随整数scrollHeight/最大夹限变化，但尚不足以断言责任在某个库size模块。启用公共RO开关虽消除折叠的大幅中间帧，3次仍只有1次通过，另2次最终偏移1.0625px且伴随RO-loop错误，因此既不能放宽≤1px断言，也不能把该开关列为方案。

§9.10.2的C1待授权范围保持不变：仅`followOutputSystem.ts`、`scrollToIndexSystem.ts`及必要system wiring/type/定向测试，失效范围严格限定follow-origin，不碰initial或明确回底。折叠/内容增长不属于该次请求范围；当前证据尚不足以把1.0625px最终误差或中间往返归到某个size模块，更不足以提出另一组依赖修改。必须先完成同一按钮、row上下边界、浏览器`maxScrollTop`夹限与DPR的来源归账，再审公开合同内是否仍有修正余地。现在没有提出或实施额外依赖范围，也不把prepend #1493机制泛化到内容resize。

当前可交付判断仍须等待下一次冻结完整suite；定向结果不代替全量，Android真实设备也尚无通过证据。

#### 9.10.4 第二轮完整验收与HistoryDemand边界修正

第二轮冻结前完整Vitest为**118 files / 647 tests passed**，production build通过（4357 modules）；保留jsdom Canvas提示与大chunk警告。随后完整Chromium为**140 passed / 10 failed / 2 skipped**（单worker，9.2m，`test-results/full-browser-final-2`）。失败严格归账为：折叠保位1、warm-cache同一顶部输入重复demand 1、下方tail行增长误补偿1、C1标准/no-append 2、未更新视觉基线5。skip为需真实PTY的F8-001和需隔离headful经典滚动条的原生thumb；窄桌面或合成pointer没有冒充它们。D/E全族、receipt/feed双顺序与uncertain重连、HistoryDemand continuous/underfill/Home/reverse/oldest/switch/scope/filter/access/100k、恢复长文本/删除fallback/初始化上滑+迟到prepend，以及following意图与几何正反例均通过。视觉基线没有自动更新。

完整轮暴露的warm-cache失败不是连接噪声：同一wheel到顶后，第一个缓存demand约4ms内完成，随后同一input的`scrollend`又以相同anchor 99926建立第二个operation。现在主scroller按`activationID + inputEpoch`去重物理顶部需求；`scroll`与`scrollend`仍都可提供真实0px证据，但同一输入只创建一次，下一次真实wheel/Home会有新inputEpoch。warm-cache、underfill、Home同组定向3/3通过，没有增加时间窗。

阅读观察也收紧为整次activation所有权：`onReadingObservation`在controller reducer和任何副作用前拒绝stale activation，不能出现“reducer拒绝但旧scroller仍markRead”的半拒绝。合法tail观察只上报当前Presentation实际安装的`visibleHighSeq`；远端`headSeq`可以领先本地窗口，不能被当成用户已经看见。回归用远端head 99、安装seq 1验证合法调用仅`markRead(1)`，stale atTail零调用。

欠供给是持续HistoryDemand而不是一次edge：coverage key现包含scheduler的attached/generation/loading/error/completedPages/revealVersion状态，真实scheduler重试/挂载状态推进会在相同几何下重新兑现，不靠轮询timer。pre-attach或local-only返回的`exhausted`不缓存为远端权威边界；只有已attach且明确`hasOlder=false`才缓存，generation变化或`hasOlder=true`会使旧结论失效。新增“pre-attach exhausted→attach”与“failed→scheduler loading”两条相同viewport回归通过；focused unit 13/13，扩大HistoryDemand/Reading owner unit 46/46。

上述修正后完整Vitest为**118 files / 649 tests passed**（14.18s），production build再次通过（4357 modules，2.56s）；仍只有既有Canvas与chunk-size提示。

第二轮之后的改动尚未再跑一遍完整browser，因此不能把140/10/2改写成最终数字。已知仍未关闭的真实项仍是§9.10.2两条C1、下方a-119增长导致a-118被`scrollBy(+28)`、fold 1.0625px夹限/舍入及5项视觉审查；未获授权前不改依赖或扩大size范围。

#### 9.10.5 第三轮总账、初始化边界与视觉逐图审查

第三轮冻结完整Chromium为**137 passed / 13 failed / 2 skipped**。相较第二轮新增失败不能归成“只剩C1”：其中包含fresh following在500ms可读降级后接收分批初始data但未留在最新端、频道access轨迹因此看不到已安装账本末尾、通知未读、以及既有fold/tail-resize/C1/5项视觉。之后的定向修正不追溯改写该全量数字；下一次完整冻结轮之前仍没有最终验收数字。

初始化readiness不再比较`visibleHighSeq >= remote headSeq`。远端head可以以隐藏协议事实结束，这个比较会令已完整投影的频道永久“不就绪”；反过来，`messageCurrent`也不能单独证明React已提交当前Projection。当前接线由Replica公开面向Presentation的语义revision，immutable Presentation snapshot公开其已消费的`sourceRevision`；两者一致才完成fresh-following初始化。隐藏事实推进revision但不改变可见行时，只发布新的snapshot壳，`rows/entities/row identity/presentation geometry revision`全部保持，不能触发重挂或滚动。聚焦单元9/9及相关owner组53/53通过；真实underfill、warm-cache和cached-progress 3/3通过，且underfill诊断明确为`attached/messageCurrent/bottomReady/hasOlder=true`。

这条边界没有掩盖初始分批append风险。access聚焦轨迹有一次在频道切换后先展示103–110，500ms预算到期后按合同解除空白；随后账本状态已到`SEQ 854`，但可见窗口仍未出现119。该聚焦组为**3 passed / 1 failed**，trace保存在`test-results/revision-readiness`；同一源码的后续完整轮里access用例通过，因此这是实际可达的时序波动，不冒称稳定必现，也不能因一次通过删除证据。这不是等待书签或history命令，没有用同activation的`key`变化/remount修复；先前尝试的“degraded→current后二次重挂”已完整撤回。它保留为公开follow/初始分批append风险，与§9.10.2用户接管的两条稳定C1分别记账。

HistoryDemand失败重试已经由既有Scheduler负责：物理请求catch进入`retry`，写入`retryAt`并经`scheduleWake`唤醒；没有新增轮询器。新增fake-clock回归证明第一次失败只安排500ms一次wake，wake后第二次失败只安排1000ms一次wake，微任务期间请求数保持1、2而不形成紧密循环；定向1/1通过。

五项视觉失败先逐图审查，随后只对人工已确认合同的图做定向更新；没有批量`--update-snapshots`：

- VIS01：timeline mask底边约627→586、Composer顶约634→618，来自已批准的`reading slot + 32px gap + natural-height input` Surface合同。测试先精确断言32px gap、输入栈自然高度/上限和未受限状态，再将动态timeline与`.seq-label`分别mask；人工审查后只定向更新`desktop-workspace`。
- VIS03：新增“模板ID（可选）”令modal约620→680高。它不是为截图临时扩UI：既有`USER-INTERACTION-SPEC`§10.1和`PHASE-D`§6明确要求可选既有template，且开工前overview已有相同能力。测试保留字段可见断言，人工审查后只定向更新`channel-create`。
- VIS09：目标区域宽964→958、高180不变。为排除测试自身hover，截图前将鼠标移到非交互角落、等待两帧并确认目标turn不匹配`:hover`；同一轨迹仍稳定得到958×180和1539像素差。expected/actual右缘均是`overflow: visible`目标内随裁切边界露出的同turn内容，并非hover/tooltip消失后即可稳定的差值。因此09仍未批准、未更新，不能将它并入已验收主体布局。
- VIS10：原oracle把高度随实时条数变化的`.activity-list`本身作为mask，mask也参与像素比较。现改为固定`.side-panel-scroll`截图区域，同时在截图外保留Activity/Operations真实tab选择状态、列表可见和至少一项可操作行断言；header/tabs仍以真实像素比较。只定向更新`global-activity`后复跑1/1通过。
- VIS13：文件详情标题、正文和split未见实质变化；背景timeline mask与Composer位移和VIS01同源。测试保留实际文件名/预览正文断言以及同一Surface几何合同，人工审查后只定向更新`channel-files-preview`。

人工准入的VIS01/03/10/13在同一源码上定向复跑为**4/4 passed**；更新文件仅对应四张基线。VIS09仍保留失败证据`test-results/vis09-hover-audit`，没有更新。这个定向结果不追溯改写下述完整Chromium的9 failed数字。

通知失败的责任层也已关闭：同一turn收到第二个terminal时fold仍保留原terminal/anomaly，但现在把该已安装账本事实纳入row的`lastSeq`范围，避免未读计数包含新seq而Presentation永远无法报告看见。对应unit 7/7、频道通知重复3/3通过；没有接受第二个terminal为正文，也没有用远端head直接markRead。

本节修正后的最终冻结运行结果为：

- 完整Vitest：**118 files / 652 tests passed**（13.85s）；只有既有jsdom Canvas未实现提示。
- production build：**passed**（4357 modules，2.50s）；保留大chunk提示，不复制`dist`、不部署。
- 完整Chromium：**141 passed / 9 failed / 2 skipped**（单worker，9.2m，`test-results/full-browser-final-4`）。运行期间源码冻结。

9个失败与已审责任逐项一致：fold 1.0625px最终夹限、浏览中tail下方内容增长造成+28px、§9.10.2两条C1，以及VIS01/03/09/10/13五项视觉。完整轮当时的2个skip是F8-001和headless环境没有classic gutter的native thumb；合成pointer和窄桌面没有冒充设备/原生拖条。其余频道/scope/filter/access恢复、HistoryDemand、100k DOM预算、warm cache、通知、B/C/D/E、cold prepend/fast reverse、return-bottom C1及no-resize control均在本完整轮通过。未授权依赖范围仍未修改。

完整轮后又做了两组不改运行策略的有界证据补充：

1. access初始分批发布使用既有mock协议，只把history页延迟设为750ms（超过500ms可读降级预算），固定seed 1722/1723/1724并逐帧保存`test-results/access-delayed-evidence/access-initial-*.json`。三轨迹均在约100ms完成频道切换，约250–470ms Replica header先到SEQ845–852而DOM仍0行；约500–615ms发生可读降级，此时诊断均有`sourceRevision=8 / presentationRevision=8 / visibleHighSeq=0`；约763–765ms首批history完成，约944–954ms scroller存在但尚未物化行，约1123–1150ms物化并回到末尾，最终gap≤24且119可见。定向结果**3/3 passed**。这证明该三次中Presentation消费边界没有落后；真实风险窗口位于降级后首批data发布到Virtuoso物化/follow之间。它不抹掉此前普通轨迹的一次波动，也没有用remount、第二writer或外部补偿绕过。
2. native thumb在隔离headful Chromium/Xvfb下以`ATOLL_NATIVE_SCROLLBAR_HEADFUL=1 ATOLL_CHROMIUM_EXECUTABLE=/snap/bin/chromium xvfb-run -a npx playwright test tests/browser/reading-viewport.spec.js --grep "native Chromium scrollbar drag"`运行，classic gutter存在，真实`page.mouse`拖动原生scrollbar轨迹**1/1 passed**。默认headless整套仍会按环境门skip，补充结果只关闭“从未验证原生thumb”的证据缺口。

F8-001的skip也修正归因：它已经使用mock服务中的真实OS PTY（`/usr/bin/script -qfc`），当前环境同时具备`/usr/bin/script`、`/usr/bin/zsh`和integration shell脚本，不需要也不允许启动真实后端。该轮源码仍标`test.fixme`，阻塞是频道切换后按钮表面可点但当前频道identity/readiness尚未交接时，旧DOM入口会消费用户点击。诚实恢复条件是让按钮和操作入口共同拒绝旧频道输入，目标identity稳定且access可见后再开放，并把`fixme`改回`test`运行隔离mock用例；不能把环境具备PTY冒称为该UX已通过。后续关闭结果见§9.10.6。

#### 9.10.6 终端交接、视觉签收与最终冻结轮

F8的实际错配不在“同一React commit里按钮与入口使用不同access条件”：旧实现二者本来相同。真实窗口是频道项`onSelect`已经发出，但父workspace尚未提交目标频道时，旧DOM和旧handler仍共同指向上一频道；紧接的终端输入会被旧频道消费，之后新频道提交，看起来像静默失效。AppShell现在本地发布这段pending handoff：频道列表和键盘频道切换共用该入口，pending期间终端按钮、移动菜单与Ctrl+F12均不接受输入；`workspace.channel.id === activeChannelId`且目标access可见后才允许打开。已经打开的当前频道即使权限刚撤销仍允许收起，但终端内容本身继续受当前identity+content access隔离。pending不是第二路由权威，只保存最新`target/origin`和是否已离开origin：每次选择（包括快速反选当前频道）都替换旧事实；稳定提交目标或第三频道即结算；`useChannelDirectory`先发布已失效目标、再fallback回origin时，以已观察到的departure区分“仍在等父commit”并结算。确定性单元覆盖延迟commit、B未commit时快速反选A、第三频道supersede、失效目标经空workspace退回origin及权限撤销后的安全关闭，focused为**11/11 passed**。原F8-001没有sleep/force，解除`fixme`后真实OS PTY轨迹通过，并在最终完整轮继续通过；本次pending补充后未重跑完整轮，不能用focused结果改写下述冻结总数。

VIS09在人工确认固定6px来自成熟组件原生gutter后，只更新这一张基线。更新前保留了行为oracle：主scroller的`scrollWidth <= clientWidth + 1`，请求正文、回答正文及任务控制按钮的横界均在主scroller可视范围内且无零宽节点；鼠标移出并等待两帧后turn不再`:hover`。定向更新及随后不带update的确认均**1/1 passed**。VIS01/03/10/13沿§9.10.5批准结果不变；最终完整轮全部视觉项通过。

同一冻结源码的最终验证为：

- 完整Vitest：**118 files / 654 tests passed**（13.93s）；仅既有jsdom Canvas未实现提示。
- 完整Chromium：**150 passed / 4 failed / 1 skipped**（155项，单worker，9.5m，`test-results/full-browser-final-5`）。
- production build：**passed**（4357 modules，2.64s）；仅保留大chunk提示，不复制`dist`、不部署。

唯一skip是默认headless Chromium不提供classic scrollbar gutter的native-thumb用例；它已在隔离headful Chromium/Xvfb以真实鼠标拖动**1/1 passed**，故是默认运行环境限制，不再是“从未验证”。F8不再skip，也不是环境缺PTY。

四个失败均保留原断言和artifact，没有用重跑偶然绿覆盖：

1. following尾端新增审批时，`scrollHeight-clientHeight`从396增至673，`scrollTop`有一个50ms采样仍为396，下一采样才到672；无反向递减，但存在约277px的append首帧空隙。现有trace与已安装4.18.13只读源码完成了责任核验：动态尺寸分支在`totalCount`变化后先订阅`listRefresh`，收到刷新才发`scrollToIndex({ index: "LAST", align: "end" })`；Atoll唯一Adapter在following只传公开`followOutput={() => 'auto'}`，`totalListHeightChanged`只观测geometry/coverage，没有`autoscrollToBottom`、DOM scroll写或第二跟随命令。因此该窗口位于组件公开follow的“data/DOM已增长→listRefresh→LAST scroll”顺序，不是应用高度回调另造的命令。源码机制与50ms轨迹能确认顺序和真实可见风险，但不能把采样间隔冒称精确浏览器帧耗时。
2. browsing中tail下方内容增长后，同一`a-118`锚点从-64变-92，稳定偏移28px；与§9.10.3的Virtuoso upward resize `scrollBy(+28)`证据一致，仍未获size-system范围授权。
3. following append后立即上滑+resize仍被旧`scrollToIndex`尺寸retry拉回底。
4. 无append、仅tail resize的接管仍被旧follow SIZE_INCREASED订阅拉回底。

后两条仍严格落在§9.10.2尚未授权的最小依赖修订：`followOutputSystem.ts`、`scrollToIndexSystem.ts`及必要wiring/type/定向测试，只失效follow-origin，不触碰initial与明确回底。第1条的只读依赖诊断属于现有review权限且已经完成；若产品要求消除这个可见窗口，才需要另行授权follow首帧的依赖源码修改、固定发行载体与定向回归，不能恢复`autoscrollToBottom`、外部DOM写或第二writer。第2条仍需独立size-system范围，不能偷并入C1。fold的1.0625px历史波动在本最终轮通过，不能冒称稳定复现已修，也没有据此扩大size范围。真实Android触摸/OS惯性仍缺设备证据，需要可用设备/工具而不是窄桌面替代。除此之外，本轮没有剩余可在当前授权范围内通过补UI控制器、外部补偿、remount或放宽断言诚实推进的项。

#### 9.10.7 单Adapter即时尾随仲裁：已准实施、未验收

后续整体复核撤回了两个过强推论。其一，`gap=679`用例通过直接`scrollTop -= 160`并手工dispatch scroll构造“session following但几何离尾”，没有对应真实Surface、初始化或内容resize来源，只能保留为模型特设，不能继续单独支撑恒`() => 'auto'`。其二，单Adapter消费公开尺寸通知并调用公开scroll接口不天然等于第二几何引擎；判断边界在于是否维护行尺寸树/锚点差值/scrollBy补偿、是否与builtin重复发指令。

当前批准的公共接入修订为：Virtuoso `followOutput`自挂载恒`false`并删除旧`FOLLOW_OUTPUT`分支；ReadingSession仍是唯一following/browsing、activation和inputEpoch owner。append或tail内容提交、`totalListHeightChanged`及现有scroller ResizeObserver都只提示唯一issuer重新读取**当前已提交**owner；同activation/inputEpoch仍following、初始化完成且geometry非零时，才调用一次公开`scrollTo({top: 当刻scrollHeight, behavior:'auto'})`。显式bottom也只走该issuer，intentID参与去重且0size不消费；普通提示按已提交revision、实际scrollHeight/clientHeight去重。没有render写ref授权、保存旧授权/目标的跨提交Promise、RAF或定时循环retry、scrollBy、锚点差值、尺寸树、remount或第二following副本；允许同一JS turn内不携带授权/目标的单次通知合并。initial继续`initialTopMostItemIndex`，prepend继续原子`data+firstItemIndex`。

停止语义必须分列：`auto`路径没有smooth动画待停；`followOutput=false`阻止新内建follow；VirtuosoHandle没有公开stop/cancel，false也不取消已经交付的index retry或订阅。因此新issuer只能令**尚未发出**的旧activation/epoch请求失效，不能拿新offset命令冒充取消。需定向验证append首paint、两条既有C1、no-resize、流式resize、viewport、input后晚通知、频道迟到、explicit bottom、prepend与初始化接管。库initial retry、独立upward-size补偿（现有tail +28）及真实Android继续单列，不以本结构准入宣称通过。§9.10.6的150/4/1是本修订前冻结结果。

#### 9.10.8 单Adapter首轮实施与定向反证（paint判断由§9.10.9纠正）

本节已按§9.10.7实施，但只形成定向证据，不把结构准入写成完整UX验收。生产`MessageList`删除模块级`FOLLOW_OUTPUT`并自挂载固定`followOutput={false}`；唯一`issueBottomIfCurrent`同时承接显式回底、append/内容提交、组件总高度与scroller viewport提示。执行当刻读取commit阶段发布的owner，核对activation、inputEpoch、snapshot revision、following、初始化/currentness与非零实际geometry；显式intent从**当前session**读取而不是从事件携带，0size不消费，后续高度提示可重试。普通去重使用commit revision和当刻`scrollHeight/clientHeight`，显式intentID可在相同geometry再次执行。调用仅为公开`scrollTo({top: scrollHeight, behavior:'auto'})`；scroller CSS明确`scroll-behavior:auto`，浏览器定向断言读取computed值。代码没有scrollBy、尺寸树、锚点差、RAF retry、remount或Content发滚动命令。

生命周期边界也被定向锁定：初始声明式位置未真实到尾前不自动发第二次回底；`atBottomStateChange(true)`只为后续内容/viewport提示建立“初始路径已经落地”的事实，不保存另一个following值。append commit若先于组件布局通知，只能重新评估，不能携带旧授权；组件回调早于owner layout发布时会因revision不匹配拒绝，随后owner commit提示重新评估。向上主列表输入以`flushSync`先提交browsing/inputEpoch，任何晚height/viewport提示再读当前owner后失效。嵌套代码滚动用Virtuoso行`data-known-size`已提交作为采样边界：安装嵌套区本身的内容resize尾随与随后nested wheel的输入归属分开，后者主scrollTop/inputEpoch不变；没有按嵌套元素类型禁用合法内容resize。

当前准确运行账如下：

- focused unit：`message-list-lifecycle`、`timeline-reading-integration`、`view-session`合计**9/9 passed**。新增断言覆盖builtin follow恒false、following commit唯一即时写、用户接管后晚height提示不写，以及显式回底在0 geometry不消费、下一次已提交height提示执行并消费。
- 第一轮三文件Chromium为**24 passed / 2 failed / 1 skipped**：两条真实C1、no-append、no-resize、following内容多次revision、cold prepend/快反向、初始化接管及F3严格尾随均通过；失败是既有browsing +28和nested采样混入安装resize。修正采样边界后的nested focused为**1/1 passed**。
- 冻结第二轮三文件Chromium仍为**24 passed / 2 failed / 1 skipped**：两条C1及其controls继续通过，nested通过；失败是既有browsing +28与F3 append首paint。默认headless唯一skip仍是classic gutter不可用，已有§9.10.5隔离headful真实鼠标证据，不在本轮重写。
- F3 append随后固定seed独立重复**5/5 passed**，但不能抹掉第二轮同源码真实失败。失败样本中审批卡数量已经从1变2、`maxScrollTop`从396变673，而`scrollTop`仍有一个50ms采样为396，下一采样才到673。当时只能确认JS可观测窗口；该证据**不能证明跨paint**，后续帧/commit顺序见§9.10.9。
- 当前生产build **passed**（4357 modules，2.83s，仅既有large chunk提示），`git diff --check`通过；最终focused C1同时从浏览器读取computed `scroll-behavior:auto`并**1/1 passed**。没有复制`dist`或部署；这不是完整unit/browser冻结轮。

因此本修订已经关闭先前两条C1：builtin follow不再创建旧`scrollToIndex` retry或SIZE_INCREASED订阅，用户接管后的提示也无法取得新授权。首轮仍存在严格50ms oracle失败，但当时没有足够证据把它称为跨paint或组件必须修改；§9.10.9继续用公开List commit完成因果审计与接入。历史`skipAnimationFrameInResizeObserver`实验会产生大量RO-loop错误，且折叠3次仅1次通过，本轮没有恢复、屏蔽错误或用它冒充方案。既有browsing +28仍是Virtuoso独立upward-size补偿；initial retry仍只属声明式初始化；两者均未被本issuer修改。

#### 9.10.9 append提交时序与公开List commit接入

在不改依赖、不增加滚动writer的前提下，生产`MessageList`加入只读时序hook，记录React owner/row/List commit、`totalListHeightChanged`、scroller RO、issuer进入/拒绝/写入、rAF采样及实际geometry。原严格F3轨迹没有删除或放宽；带观测重复10次为**6 passed / 4 failed**，失败artifact在`test-results/adapter-follow-timing-trace`。

一条失败轨迹的实际顺序为：owner先发布`revision=3 / rows=6`，但DOM仍是旧`scrollHeight=881 / max=396`；约10.7ms后新approval row commit使DOM成为`scrollHeight=1158 / max=673 / top=396`；公开List layout commit约1.6ms后观察到相同新geometry；默认`totalListHeightChanged`再约3.3ms后进入issuer并立即写到673。没有`oldrevision`拒绝、`initialTailReady`门误拦或错误去重：旧revision3写入键含height881，新height1158产生不同键。该捕获样本中，rAF记录的callback timestamp早于其实际执行约50ms，随后同一渲染机会的ResizeObserver/total-height完成写入；既有Playwright screencast中，新approval第一次出现在画面时已经在底部。因此该样本定位了**React DOM commit到默认RO发布之间可被JS读取的瞬态**，但没有证明它跨过paint；也不能从这一条轨迹推出所有50ms采样都不跨paint。

React Virtuoso公开`components.List`允许稳定、forwardRef的自定义List，并通过公开`context`接收Adapter通知。当前接入只在List `useLayoutEffect`报告“DOM children/spacer已commit”；它不取得scroller ref、不读行尺寸、不计算差值，也不携带following授权。由于子List layout effect可能早于Virtuoso公开handle及外层owner layout effect，本通知在同一JS turn内合并为**一个microtask**；microtask只调用既有`issueBottomIfCurrent`，执行时重新读取当前activation/inputEpoch/mode、初始化事实、intent及实际geometry。它不是RAF/定时重试或任务循环：同turn多次List commit只交付一次；用户/activation若已改变，既有issuer门直接拒绝；写入导致的后续List commit以geometry key去重终止。

最终trace在`test-results/adapter-list-commit-microtask-trace-final`：owner revision3先发布；row/List commit看到1158；microtask delivery在`totalListHeightChanged`和下一rAF采样之前以当前revision3写到673；后续List/height提示均以相同geometry key去重。严格F3随后**10/10 passed**（此前直接List通知另10/10仅作机制对照，最终合同以microtask版为准）。C1两主轨迹、no-append/no-resize及nested两轨迹**6/6 passed**；频道恢复、长文恢复、初始化中接管、following切频道/多次revision、cold prepend/快反向与clamp组合**8/8 passed**。生命周期focused unit新增三条边界：排队后用户接管、旧activation替换/卸载均零写，scroll触发再次commit由geometry key终止；当前文件**6/6 passed**。此前focused unit **9/9**及production build **passed**（4357 modules，2.43s）、diff-check通过仍是修订前一阶段的定向记录。这些都不替代下一次同源完整冻结轮。

`initialTailReadyRef`只记录“一次声明式initial tail已经真实到尾”的完成事实，不决定following；唯一mode仍在ReadingSession。初始未落地时自动List/height提示不能发第二个回底；公开`atBottomStateChange(true)`或一次有效显式bottom使它ready。following切频道和多次内容revision的浏览器轨迹证明它不会长期false饿死；browsing即使几何到尾也不会因该事实取得业务授权。显式bottom独立读取当前intent：0 geometry不消费，后续List/height可再评估；intentID参与去重，故同geometry的新用户回底仍可执行。

嵌套滚动保留两层oracle：一条在安装导致的row测高提交后隔离验证inner wheel不改变主inputEpoch；另一条在已经安装的inner scroller外层行再次增高后**立即**发真实inner wheel，不等待新增长稳定。后一条允许唯一issuer因合法following内容resize移动主列表，但要求inner实际滚动、ReadingSession始终following且inputEpoch不变，最终仍到尾；该组合通过，未用“主scrollTop必须不动”的错误断言隐藏并发。

当前仍未关闭的几何项没有变化：browsing upward-size补偿+28、历史fold 1.0625波动、库initial retry的独立风险与真实Android设备证据。List commit接入没有触碰这些路径，也没有重启同步RO、改依赖、外部像素补偿或第二writer。

#### 9.10.10 有界阅读诊断与tail责任矩阵

为响应真实冷历史轻微回弹反馈，本轮没有盲调buffer、`defaultItemHeight`或RO参数，而是复用`src/model/diagnostics.js`增加默认关闭的reading flight recorder。它只在内存保留最近1024条，导出单调时间/序号/`dropped`和版本参数；不逐条console或sessionStorage、不上传。`MessageList`的诊断detail采用lazy factory，关闭且没有测试sink时在读取任何诊断专用`scrollHeight/clientHeight/getBoundingClientRect`之前返回；单元测试证明off时factory/getter零调用、on时才读取。history row不逐条记：同一batch只汇总count、到达首末及min/max seq、首末到达时间和duration。所有生产调用点只传activation、inputEpoch、revision、row ID/seq范围、输入类型/delta、请求/批次状态、几何和issuer原因等元数据，不传正文、草稿、凭据、token、envelope或payload。

严格tail轨迹保留原`≤1px`断言并导出完整链：browsing、inputEpoch 2、真实wheel `deltaY=-180`后，语义锚`a-118`仍是同一未改写行；增长的是其下方且在viewport外的`a-119`，实际高度168→196（+28）。List commit观察到`scrollHeight` 19268→19296时`scrollTop`仍17188，随后在`totalListHeightChanged`前组件内部把`scrollTop`写为17216，锚top -64→-92。应用issuer全程因browsing拒绝，`issuer-write=0`。still/up/down × changed-row above/below六格矩阵进一步分离责任：up+above时+28补偿有助于保持阅读点；up+below时同一补偿叠在用户-180运动上，造成28px反向nibble；still/below与down/below没有该写。只读4.18.13 dist显示该内部路径以`scrollDirection === "up"`和总高delta决定`scrollBy`，没有判断变化行相对可见锚的位置；公开handle没有只取消/限定这项upward-size补偿的接口。`fixedItemHeight`、减少overscan、冻结内容、外部反向scroll或remount都不能在不牺牲真实可变内容/快反向UX或违反单writer的情况下闭合，所以该项仍是明确未通过，未修改依赖。

冷prepend/快反向使用生产列表重跑8轮，导出416条、`dropped=0`、9次真实input、0次应用issuer写；每轮同一语义锚的全部采样screen Y漂移均为0。prepend中的`scrollTop`与内容高度同增3960px是组件保持语义锚的合法补偿，而不是仅凭scrollTop数值判定的回弹。该fixture没有复现用户报告的轻微回弹，故证据只关闭“本轨迹发生语义跳位”，不能否定真实反馈或从相关性宣称参数根因；网络历史预取与渲染overscan分属不同责任，`defaultItemHeight=132`也不是固定prepend估值。新的opt-in导出已经能把真实input、history请求/批次到达、List/RO/range、锚点与issuer决策连起来，后续应在实际可复现轨迹上取证，不让用户承担日志收集，也不新增后端上传。

本轮focused验证为**5 files / 53 tests passed**；冷prepend真实Chromium **1/1 passed**。这些发生在§9.10.9之后且不是新的完整冻结全套，不能改写§9.10.11的151/4/1或宣称tail/fold/Android已经通过。

#### 9.10.11 最新完整冻结总账与早操作证据

最新一次完整同源冻结不是§9.10.6的150/4/1，而是：完整Chromium **151 passed / 4 failed / 1 skipped（156项，`test-results/full-browser-list-commit-frozen`）**，完整unit **661 passed / 1 failed（662项）**，production build通过（4357 modules，4.79s）。unit唯一失败是旧静态架构regex仍寻找已删除的follow分支；其后已改为同时验证Virtuoso生产入口、`followOutput={false}`、唯一公开`scrollTo({top:scrollHeight, behavior:'auto'})`以及显式/自动提示共用`issueBottomIfCurrent`，不是放宽regex。但这项focused修正没有追溯把完整unit写成全绿。

完整Chromium四项失败为：F3 Composer基线在初始交接时采到`.composer-surface`高度0；fold原`≤1px`逐帧保位；B-BR-06 receipt/feed用例在收件人目录就绪前操作而未真实提交；以及浏览中tail下方内容增长+28。默认headless唯一skip仍是classic scrollbar gutter不可用；已有隔离headful真实鼠标证据。后续append首帧/C1公共List commit、静态合同、F3/B前置等focused证据均不得把这组完整数字改写为全量通过。

F3与B没有只靠“等到绿”隐藏早操作。F3新增handoff证据，逐采样断言只要composer input已可见，surface就不能为0；真实focused样本为`surfaceHeight=76 / inputHeight=30 / inputVisible=true / reading restoring=true`，说明restore期间输入可以可见且具有有效几何，原0样本属于尚不可操作的mount交接。正式基线只在生产`.timeline-message-list`和非零composer几何提交后读取，不使用固定sleep。B-BR-06先把receipt故障轨迹的前置改为真实可提交，再另加B-BR-06a覆盖目录未就绪时的早操作：输入草稿后点击发送显示既有收件人警告、`agent.ask`提交帧保持0、草稿不清；同一草稿在名册目标可选后提交并最终出现PONG。B06成功/uncertain对账与B06a早阻止是两条独立oracle，不能以前者替代后者。

§9.10.10之后诊断还增加故障隔离：detail factory或测试sink抛错都不得中断唯一issuer或应用提交，异常消息不进入导出；对应focused **3 files / 47 tests passed**。加上历史到达首末/min-max语义修正后，先前五文件focused现为**53 passed**，仍只作增量。

#### 9.10.12 fold责任收敛与有限内容连续性fuzz

fold原`≤1px`逐帧断言在默认接入下重复12次为**0 passed / 12 failed**，没有稳定等待、取整或放宽。常见轨迹是row 2272.4375→539.09375、`scrollTop/maxScrollTop`在整数边界变化、`scrollHeight`随后再增1，按钮中间偏移可达1.5px、最终约0.875–1.0625px；另有一次按钮412→466→2241、scrollTop 4721→2988→1308的真实大跳，不能归为DPR舍入。trace证明pointer接管已经把ReadingSession提交为browsing/inputEpoch+1，collapse后的全部应用issuer均拒绝、`issuer-write=0`；row/list margin均0、transform none，按钮与row/list top同幅变化。

两条公共/前端owner假设均做了原断言对照并撤回。把固定`14*23px`裁切改为继承line-box的`14*1lh`后12/12仍失败且常见误差扩大到约1.1875–1.375px；已恢复原23px。Virtuoso默认`itemSize`把`getBoundingClientRect`结果`Math.round`后放入size tree，曾用公开`itemSize`回调提供fractional DOM尺寸；正确字段映射后4次为2 passed / 2 failed，且失败出现559→200→559、412→464→2239的大跳，风险更高，已删除该prop。当前生产没有留下任何fold调参、补偿或阈值变化。

责任因此分成两层：普通亚像素波动来自真实fractional line box、组件整数size tree和浏览器整数scroll clamp的边界；大跳发生在内容骤减先令scrollTop数值向上后，组件内部upward-size compensation把active changed row的负size delta再次当作向上阅读补偿。4.18.13公开API没有按变化行/动作origin限定或取消该内部补偿的能力。应用反向scroll、保存按钮差值、固定高度、冻结fold或放宽oracle都会违反单writer或原UX；本轮不实现、不fork。artifact为`test-results/fold-diagnostic-frozen`、`fold-reading-trace`及两条已撤回对照目录。

为避免只用锚Y回答用户报告的闪烁，另以生产`MessageList`夹具做有限固定seed行为fuzz：seed 2711/2712/2713，每次真实wheel初始-1300后四次快反向；每个输入自然运动两帧后才建立同一未改写语义点基准，再于32ms注入controlled prepend批次、56ms并发append+live tail resize，逐步保存真实scroller截图。观测只记visible row ID/node serial、物化/可见计数、viewport上下覆盖、row-error、opacity/visibility、Mutation add/remove、List/range/issuer和long task，不记录正文。三seed各109–110个采样帧中，空viewport/上下空slot/row-error/hidden/opacity0均0，long task 0，应用issuer write 0，各输入段语义点漂移0；trace 294–296条且`dropped=0`。结果为**1/1 passed**，artifact `test-results/reading-flicker-fuzz-before`。这只说明该synthetic fixture和这些速度/延迟没有复现闪烁，不能否定真实产品现象、也不能用锚点稳定替代paint证据；独立闪烁Agent继续真实生产场景调查，本owner不重复跑。

诊断异常隔离与上述测试接线后的focused unit为**5 files / 55 tests passed**，仍不改写§9.10.11完整冻结总账。

#### 9.10.13 未知高度prepend白帧与三项几何未闭门的集成影响

独立闪烁Agent以synthetic fixture和真实CDP compositor帧做了五组控制，不改生产代码/参数：seed 4101（prepend 0ms+连续快上滑）7帧/白1，4102（32ms）9/1，4103（96ms）8/1，4104（相同快上滑、无history）4/0，4105（静止触顶+32ms prepend）5/1。它证明这四条prepend轨迹均观测到白帧、且4105中持续输入不是必要条件；但当时只有一条fast/no-history阴性对照，没有stationary/no-prepend对照。结合§9.10.16中极端headless环境的静态DOM白帧，本组不再推出“prepend是白帧的充分原因”或“无prepend快滑必然不足”。这些数字已经root审阅，但其原始V1/V2临时artifact位于共享`test-results`根，后被一次未指定独占`--output`的Playwright运行清理且无备份，当前不能据原路径重新复核；可继续复核的跨候选证据只引用§9.10.16所列已归档文档。

4105给出组件路径与应用排除链：prepend owner commit为revision2、rowCount430、`firstItemIndex=999970`、首行`old-1-0`；原row0绝对index仍1000000，排除data/index错配。初始估算补偿令`scrollTop 0→3960`；约207.1ms总高实测修正又令3960→8880（+4920），但物化range仍为999987..999991（old17..21）。range约232.3ms才推进到999992..1000008，rows约242.7ms commit，List约250.3ms commit。compositor语义帧为`row0 → old-1-19 → 全白 → row0`；JS/DOM侧可见旧range已被移出、新range随后提交的时间窗。期间items不空、所有slot有ID、无undefined/rowerror/hidden/opacity、longtask为0、诊断dropped为0；应用issuer全部`browsing-rejected`且write为0，因此可排除网络空数据、Presentation空集、key错配、Content隐藏和外部writer。§9.10.16的静态DOM反例要求把“时间窗与白帧同轨出现”保留为待对照假设，不能升级为精确frame因果。

三项未闭门的关系如下，不能笼统合成一个“调参数”问题：

| 未闭门 | 共用部分 | 独立触发/仍需单独验收 |
|---|---|---|
| tail下方行增长+28 | Virtuoso内部size/listState/upward compensation读取总底部变化并写scroller | 变化发生在可见锚下方仍补偿，缺少按变化项与锚位置限定；数据无prepend |
| fold大跳 | active行骤减和浏览器clamp使数值方向变up后进入同一内部补偿子系统 | changed active row收缩/夹限后的重复补偿；普通0.875–1.0625px仍是fractional line box、整数size tree和scroll clamp，独立于大跳 |
| 未知高度prepend白帧 | 同属size/listState/upward correction，组件为维持prepend语义锚执行必要补偿 | 初始beforeUnshift估算之后的**第二次实测修正**先scroll、range/rows/List后commit，属于提交时序空窗；不能用“下方变化不补偿”规则处理 |

因此不能在用户接管时简单取消prepend补偿：那会把白帧换成历史插入后的语义锚跳动。合法data与`firstItemIndex`同批、稳定row key、单Adapter无外部writer已经在4105证据中成立。最小修正职责仍在组件的尺寸/上行补偿owner内部：existing-item resize只对严格位于保留语义锚上方的size delta补偿；prepend的实测correction须与替换range/rows/List DOM建立prepaint交接，执行时重读当前viewport/input而非沿用旧授权，并只保留当前/交接所需的有界重叠行，不能钉住整段历史或破坏100k DOM预算、selection、继续滚动。initial scrollToIndex retry、fold普通亚像素继续是独立风险，不能顺带改。

官方有界核验：4.18.13 release与PR #1493（merge `d3c437e`）只让beforeUnshift的estimated deviation经过List layout-effect `deviationCommitted`后滚动；PR自身说明同尺寸重叠prepend仍有fallback。当前main的same-totalCount measured `deviationOffset`/upward-size仍直接走`scrollByWith`，没有接该ack。本轮从4.18.13到2026-09-17 main ahead4的限定核验未找到覆盖上述“第二次实测补偿先scroll、range后到”的发布修复；这是限定范围的未发现，不表述为生态中绝无方案。`1lh`和fractional公开`itemSize`两项失败只反证这两条假设，没有穷尽公开参数/接入。

当前权限不允许fork/vendor/修改依赖源码。若后续授权，待确认范围是Virtuoso的size/listState/upward compensation及render/commit acknowledgement必要wiring和定向浏览器回归；follow issuer与initial retry明确不自动并入。现有ReadingSession、单Adapter唯一issuer、Presentation/data-index合同全部保留，不重启架构或把测高补偿搬到应用层。

#### 9.10.14 假新动态与Composer发送回底回归

用户报告的“大量假新消息通知”收敛为两个前端owner错误，而不是服务端重复消息。频道rail用`unreadCounts`按稳定root去重展示，但`markRead`过去用语义更窄的`unreadCount`判断是否失效缓存；只有weak/system通知时到尾虽推进read cursor，却不publish/清rail缓存，badge可以残留。现改为显示与清除复用同一`unreadCounts(...).total`判据。项目没有浏览器/OS新消息toast入口；既有channel notice只报告Submission不确定/对账等状态，不参与消息计数。

`timeline-jump-latest`过去比较前后Presentation并把“新插入的尾行”当live到达。等待层→时间线的阶段迁移、cache尾补全或历史发布都可能形成新Presentation成员，因而误加`viewport.unseen`。当前Replica只在**accepted live commit**记录arrival：self echo排除，processing/provisional排除，terminal映射稳定root，公开event用自身稳定ID；history/cache不写。传递资源不是无限日志：固定1024热journal，热窗在一次React消费前溢出时只为尚未ack的稳定身份保留精确overflow集合；ReadingSession接收该revision后立即ack清热窗/overflow，后台频道没有viewport义务而直接基线ack，账号Replica reset/channel state销毁也一起释放。ReadingSession只消费当前activation之后且能在当前Presentation命中的身份，当前未读`unseenKeys`随ViewSession完整保存、不再截256，并在回底时清空；所以资源与“这次尚未读的不同身份”成正比，不随已读频道的终身事件增长。metadata/同ID正文修订、重复feed和本地echo不制造独立通知，真实live动态仍累计；切scope/filter建立新activation时以当刻revision为baseline，不把旧发布补算成新到达。

用户同时确认“发一条普通消息应自动回底”。修订没有给Composer或Timeline滚动ref：Composer在提交发起、第一次await之前经窄`ReadingIntentContext`捕获ReadingSession的`activationID/inputEpoch/intentRevision/mode`，普通消息的`onSend`只有在Outbox durable接受并发布稳定message IDs后，才尝试消费该token并调用一次`ReadingSession.requestBottom`；多收件人批次一次。接纳等待期间的上滑推进inputEpoch/intentRevision，A→B→A产生不同activation，二者都令旧token失效。controller只有React layout owner可start，卸载同步suspend；`update/setUnseen/addUnseen`不再能让旧异步闭包重新activate。表单/草稿CAS失败或空结果不调用；slash、edit、receipt、feed echo、重试、任务/治理控制没有该入口。唯一MessageList issuer仍在执行时检查当前committed owner、activation/inputEpoch/geometry。

原一轮增量证据为focused unit **6 files / 63 tests passed**、production build通过（4358 modules）及Chromium **4/4 passed**：两条新F7真实历史轨迹、既有频道通知基线和B-BR-08切频道迟到确认。root随后指出durable接受本身可能晚于用户输入，原证据未覆盖该窗，故当时结论撤回。当前补充的竞态/上界focused为**6 files / 71 tests passed**：真实Composer deferred `onSend`只在发起点捕获一次token；hook确定性覆盖`submit→user up→resolve`零新bottom、`A→B→A→旧resolve`零新bottom且旧controller不重新activate；正常当前token仍成功，durable acceptance拒绝不消费已捕获token；1100个稳定到达跨1024热窗精确交付并在ack后释放，300个未读身份跨旧256边界持久重进不丢，同root后续更新仍不重复，原生向下到尾同时清除已读身份集合。同源生产Chromium四条轨迹重新执行为**4/4 passed**，build通过（4358 modules）；完整unit **671 passed**仍是此前完整轮证据，本次没有冒称重跑完整冻结套。

边界复核后的新证据为**6 files / 75 tests passed**，取代上文71项增量数字。新用例确认Composer accept seam拒绝`null`/残缺token，同时当前完整token仍可创建一次bottom intent；显式按钮路径继续允许无token。Arrival反例以1100个同root终结帧造成稀疏overflow，验证ack 50仍保留revision 76聚合身份、ack 76才释放overflow、ack 1100后新unique 1101仍被交付；稀疏suffix函数在cursor 50与1000都未跳过新事件。另以2000条无Timeline consumer的live到达证明hot journal/overflow均为0；route/access卸载时consumer release同样ack回收，真实频道未读仍由已有rail/read cursor语义计算，没有为内存上界丢失未读。

#### 9.10.15 consumer后冻结验证与隔离demo观测

按root审查要求冻结生产源码后，完整Vitest为**118 files / 682 tests passed**；唯一输出异常是既有jsdom `HTMLCanvasElement.getContext` 未实现提示，不是失败。consumer修订后重跑四条生产Chromium：F7 browsing send、F7 history/progress no-fake-notice、F7 channel notification baseline、B-BR-08 switch-channel pending，结果**4/4 passed**；没有改mock、阈值、skip或浏览器配置。本轮没有重跑无关的全量browser，故不覆盖已知几何总账。

state生命周期的源码证据：`createChannelReplicaStore.ensure`为频道创建一个record/state，`commit`和`afterTrim`只原地更新；App每次render从`channelStatesRef.current.get(activeChannelId)`取回同一对象。因此消息、名册、输入等普通render不会使`useLayoutEffect([state])`重复release/ack。对象只在频道key更换、principal/cache world reset或首条数据将无record的临时空state替换为canonical Replica state时改变；临时空state不是feed commit目标。全仓检索中生产consumer注册只有`Timeline.jsx`一处，计数和release/ack全在`fold.js`同一owner，不存在第二个viewport writer。

当前几何未闭状态保持：（1）冷未知高prepend已在真实compositor捕到一帧全白；（2）browsing中可见锚下方行增高28仍被Virtuoso upward-size路径`scrollBy(+28)`；（3）fold仍有最终0.875–1.0625px夹限波动及一次大跳证据；（4）initial retry是独立风险，上述通知/send通过不解决它；（5）真实Android触摸/惯性仍无设备证据。没有放宽断言或将它们改写为通过。

三库隔离demo v1的Chromium观测：800×640页、760×600列表、DPR1、Arial 16/24、400行+30未知高prepend；fast wheel为-700/-900/-1300/-1700、间隔12ms。fast+prepend compositor整屏白帧为Virtuoso 3/3（2/3/1帧）、Legend 3/3（2/2/2）、Virtua 3/3（2/2/1）；同速无prepend三库均0/3，而rAF DOM coverage均未判空。静止触顶后prepend中Virtuoso 3/3每次一帧，Legend/Virtua 0/3。下方行+28轨迹中Virtuoso demo 2/3出现`scrollBy(+28)`且锚-42→-70；Legend锚稳定3/3；Virtua目标未物化，不可判。长行1176→168底部clamp中Virtuoso survivor稳定；Legend稳定但每次有`scrollBy(-1008)`、未见paint gap；Virtua 3/3 survivor +24且一帧135px顶部白带。

这些都是**demo观测，不是组件根因或换库结论**。v1给所有`.list-root`加了`contain: strict`，而生产`.timeline-message-list`没有；另有每scroll同步全量row geometry、每rAF全量测量、`flushSync` prepend与统一显式高度/CSS，都可能改变paint/时序。root与demo Agent正核验contain有无×重探针开关的2×2共享因素；结果未审前不得将三库白帧归为相同内部机制。v1报告中B `B-grow-stationary`实际是wheel后无增长control，证据只按“无增长对照”解读。

#### 9.10.16 fast-wheel环境混杂与候选判定纠正

新安全归档的TanStack有界卡锁定`@tanstack/react-virtual 3.14.9` / `virtual-core 3.17.7`，已包含上游发布的#1176（prepend当次range）、#1237（extent先于scroll target）、#1239（RO补偿后同步notify/transform）。这些发布修复证明“range/extent/transform与scroll的prepaint排序”是真实组件责任，但新卡的fast轨迹不能用来反推当前每帧白的组件根因。

关键反证是：TanStack heavy的fast+prepend 3/3白，同same-speed no-prepend已有1/3白；light条件两者更都是3/3。更重要的是，Headless Chrome 151 + SwiftShader下，一份静态400行、没有virtualizer也没有React update的DOM在同一极端wheel burst中也出现一帧全白。所以旧表述“三库fast均白，因而组件均不满足/换库没用”无因果基础，现正式撤回它的候选否决力。同时不能反向把用户闪烁全归为GPU：这个静态反例只证明synthetic fast track和当前headless环境存在compositor/raster confounder，不代表macOS、Android或生产慢轨迹的原因。

cc/viz卡里TanStack白图邻近`TileBasedLayerImpl::AppendQuads` / `missing_tile_count:1`：fast+prepend中位于两张白图之间，相差约9–17ms；fast no-prepend中也位于白图约11.7ms前。原trace没有把截图与missing-tile event绑到同一submitted frame的token，故只能说“时间邻近”，不得写成“missing tile精确造成每个白帧”。静态DOM白图邻近raster/DrawAndSwap但没有checkerboard event；该事件缺失也不能反向证明没有compositor/raster问题。

仍保留的独立证据与责任：

- **Virtuoso静止prepend：** 本地4105已证二次实测correction从3960→8880先执行，range/rows/List后约25–43ms提交；4.18.13/#1493只把首次`beforeUnshift`改为`deviationCommitted`握手，same-total-count实测修正仍直接`scrollByWith`。这些是组件顺序事实；由于headless环境混杂，它与白帧的frame-level唯一因果仍要对照。
- **tail下方行+28：** 生产trace直接记录Virtuoso upward-size fix在应用issuer write=0时发出`scrollBy(+28)`且语义锚从-64→-92。这不依赖白帧paint归因，不因新compositor反例而撤回。
- **其他候选观测：** TanStack在当前fixture中静止prepend、下方行增高与fold/clamp最终锚表现稳定，但fast轨迹受环境混杂，且上方行增高有独立+28 drift；这是有界比较记录，不是生产迁移准入。

下一决策边界固定为：只补当前Virtuoso静止prepend 3 trace与静止no-prepend 1 control，将输入、data commit、same-total-count correction、range/List commit、cc/viz/raster与paint分层；没有frame token就不声称tile精确因果。若静止prepend仍独立失败，再按具体责任判断公开接入、上游修正或其他有限选项；现在不预设fork，不重新泛搜或轮库。

证据保全纠正：v1原始`test-results/list-demo-comparison-v1/`已被后续一次未指定独占`--output`的默认Playwright运行清理，没有备份，现无法重开原trace/图片复核。§9.10.15的v1数字仅作当时root已审的观测记录，不得再引用丢失路径作artifact。当前可复核证据是`docs/evidence/list-demo-comparison-v2/`和`docs/evidence/list-demo-tanstack-released-fixes/`；其内锁定版本、命令、raw summary、trace和SHA256独立归档。后续所有Playwright运行必须显式指定独占子目录，不得再使用共享默认根。

这些是最新源码的focused增量，不改写§9.10.11完整冻结总账，也不关闭§9.10.13三项几何门、真实Android或默认headless classic scrollbar限制。

#### 9.10.17 UX优先与精度取舍审查（未实施）

本节只复核消息区的产品模型与现有生产接线，不修改运行代码、测试oracle、依赖或组件源码。最高层目标不是让一份无限增长的事实账本在每个后台事实到达时都同步重组可视DOM，而是同时保证：事实不丢且身份正确、用户正在看的内容不被无意抢走、历史和新消息可达、自己发送后回底、输入即时，以及有限主线程/DOM预算。对应职责应保持为`Replica事实 → 有界Presentation快照 → ReadingSession意图 → Virtuoso几何`；事实即时成立不等于每条后台变化必须在同一JS turn进入视窗。

| 要求/指标 | 来源级别 | 本轮裁决 |
|---|---|---|
| 无用户意图不抢位置；自然触顶取历史；普通发送接受后回底；身份、未读与echo去重正确；输入即时 | 用户明确需求与本轮真实回归 | 硬不变量，不以“降低精度”为名撤回 |
| 已有可读内容不出现正常用户可感知的整屏闪白；未改写阅读点不发生大跳或长期累积漂移 | 用户明确的稳定阅读/闪烁反馈 | 硬不变量；必要的prepend `scrollTop`数值变化本身不算失败，失败看同一语义内容是否跳走、消失或持续漂移 |
| 单一几何owner、应用不做尺寸树/反向补偿 | 为兑现“不抢位置”推导出的架构不变量，不是用户使用的术语 | 保留；它压低竞争写入和维护成本，不要求组件内部所有阶段接应用epoch |
| 指定未改写锚点每个可观测帧都`≤1 CSS px` | 设计/测试为稳定阅读建立的量化oracle；用户没有指定1px | 继续作为诊断的敏感尺，不再把0.0625–0.375px越线单独升级成产品失败或驱动运行时补偿；大跳、累积漂移、可感知回弹仍失败 |
| 任意重排/任意UA下所有字符零位移 | 早期设计过度推导 | 已撤回；当前段落自身重流与存活语义点另验，不造全文像素控制器 |
| Headless Chrome/SwiftShader极端wheel下每帧零白 | 为追查反馈新增的压力实验，不是用户指定环境 | 只作归因与容量证据；静态DOM也白已证明环境混杂。不能据它放过正常浏览器的可感知闪白，也不能据它否决组件 |
| 所有测量、range与scroll必须在同一paint前强制同步 | 为满足上述测试推导的工程假设，不是产品需求 | 不设为架构门。当前代码也没有应用尺寸树或同步测行；只保留有真实UX因果的意图提交和一次公开回底 |

**现有整体边界已经存在，不应再造调度权威。** `useChannelFeed`的live行先进入`createFrameBatcher`，可见投影最多延后一帧合批，pagehide/checkpoint等事实边界可立即flush；HistoryScheduler把普通hydration留在off-DOM reservoir，只让初始/用户需求/失败等必要状态发布；ConversationPresentation对流式正文按change log只替换受影响的不可变row，其他row保持身份；Virtuoso只物化窗口。故“事实列表无限增长”不要求“可视树无限即时重组”。后续简化只能封住绕过这些既有边界的重复发布，不能增加另一份pending事实、滚动状态或等待用户停滚的闸门。

本轮最多保留三条取舍路线：

1. **首选：沿现有有界发布边界，而不是追求每条后台事实同步上屏。** Replica、coverage、arrival/unread先按事实语义立即提交；当前频道live继续按一帧合批，history页在既有Scheduler准备完成后以一份不可变`data + firstItemIndex`原子进入Presentation。Composer/local echo和用户操作不等待history批次，真实新消息在有界下一render opportunity可达，浏览中的新消息继续以unseen提示而非强拉到底。收益是减少同一帧反复投影、React commit与库测高，保护输入预算；代价是后台/live可见性最多一个既有帧边界。不可接受的是扩大成任意延时、等滚动停止、冻结正文、隐藏历史或让发送结果等待批处理。现有frame batcher、silent hydration、稳定row identity是正证；未知高prepend白帧在longtask=0时仍出现，反证“再做更激进合批”本身不能保证消除paint问题。最小验收：事实/未读/echo零丢失，发送与输入不等batch，live有界出现，单个history批次只产生一次结构发布且data/index同批。

2. **从热路径撤下未被执行消费的文本点精度，保留真实阅读恢复。** 当前`visibleBookmark`在scroll/range/layout观测中调用`caretRangeFromPoint`、TreeWalker和range rect，保存`blockID/textOffset/textBefore/textAfter/textViewportOffset`；但生产`initialLocation`只消费`messageID`、successor/predecessor、`seq`和`rowViewportOffset`。这些文本字段目前主要服务测试/诊断oracle，会在滚动热路径增加DOM遍历、布局读和持久化比较，却不参与实际恢复。若root批准后实施，持续会话只保留稳定row身份与row-local offset，文本点降为opt-in诊断或离开生命周期的低频证据；长消息中段仍按同一row offset恢复，selection/Choices身份不变。收益是直接减少用户滚动时的应用工作；代价是正文自身跨激活重流时只能恢复到同一行内像素位置，而不是声称恢复到某个字形。不可接受的是退化成只记消息顶部、丢失长消息中段、删除书签fallback或用取整掩盖大跳。最小验收：长行中段A→B→A与route/access/scope退出恢复仍成立，用户输入时无额外同步文本遍历，真实大跳/闪白断言不因删除细粒度字段而消失。

3. **保留成熟组件原生测量和当前单issuer，不为1px或极端headless压力改库。** `followOutput`恒false；initial/prepend仍由声明式公开输入负责；应用唯一写入只在ReadingSession当前following/显式bottom有效时调用公开`scrollTo(auto)`。`flushSync`仅在第一次原生用户接管从following变browsing时同步提交意图，不测量行、不在后续滚动反复执行；`CommitAwareList`的layout通知只合并一个microtask并在投递时重读当前owner，也不保存旧授权、尺寸树或循环retry。它们分别保护“用户上滑后不被晚拉回”和“发送/尾随确实到最新”两条真实UX，现有C1/发送回底证据支持保留，不能因追求代码更少一概删除。必要prepend补偿可改变`scrollTop`以保持同一内容；验收观察语义点、可见覆盖和输入运动，而不是禁止数值变化。fold最终约0.875–1.0625px的非累积边界波动不值得引入第二writer；fold大跳、下方无关增长造成+28回弹仍是产品问题，静止prepend白帧观测则保持未闭归因，须以普通浏览器正常轨迹复现才能升级为同级产品阻断。最小验收：following append/内容增长/viewport变化与显式回底可达，首次用户接管后旧通知零写，browsing prepend保持语义位置且不持续空白，普通浏览器正常输入下无可感知整屏闪白；不以极端软件栅格单帧作为唯一准入。

因此当前不批准的动作包括：修改Virtuoso源码、外部反向`scrollBy`、等待滚动停止才prepend、固定所有消息高度、提高overscan到近全量DOM、恢复内建follow与应用issuer双写，或为每帧1px加入同步测量/commit。下一决策边界是root先裁决两项纯前端简化：是否把持续文本点书签降级，以及是否仅核查现有批处理边界有无重复结构publish；当前单issuer先保持。组件缺口只在当前Virtuoso的正常静止prepend对照、tail +28或fold大跳仍以用户可感知轨迹成立时按具体责任继续，不默认fork、不迁库。

#### 9.10.18 P1/P2增量与W5自动查询事故止血

W2/W3的本轮有限接续已经进入生产代码：主列表只在同activation的真实向上输入，或仍由该手势驱动的实际向上scroll穿入near-edge时建立runway需求；frontier+inputEpoch去重，停止/转向/换activation后range/layout自身没有揭历史权限。Scheduler一次只释放8条raw records/256KiB，预算穿过`operation.next`；无可见投影进展时在既有operation内让出一个浏览器task，单个超大raw record仍是活性例外而不是几何上界。Virtuoso公共窗口保持原有限值并新增`minOverscanItemCount top6/bottom2`，没有近全量DOM、第二尺寸树或scroll补偿。bookmark持续观测只取row身份与row-local offset，文本点扫描降到scrollend/lifecycle/debug低频，恢复仍保留同消息行内offset。

生产runway轨迹以seed1730、独占端口/output运行1/1通过：同channel/epoch/anchor的`history.intent_started(runway,8,262144)`取得对应`satisfied`，projection一次释放8条并越过原anchor；72个DOM采样空窗0、最大物化15，19个去除固定状态槽/滚条的compositor ROI均有正文前景，应用issuer写0。2026-09-17又在同一冻结源码指纹下以独占output重签，仍为1/1通过；该轨迹只证明真实需求→有限release→显示链发生，不签署原未知高prepend白屏。

同一冻结源码紧接着运行原stationary/+30 unknown-height压力硬oracle，结果1/1失败：五个种子中seed4101 concurrent的paint5、seed4103 concurrent的paint4、seed4105 stationary的paint3为`darkPixels=0`的全白ROI；DOM coverage failure仍为0。seed4105中应用bottom issuer全程因`browsing`拒绝、写入0；prepend先按30×132估算使`scrollTop 0→3960`，实测总高从71295变79326后，库在range仍为999976..999989时把`scrollTop 3960→11991`，约24.5ms后range才变为999986..1000010，随后目标rows提交。全白compositor帧落在这段旧物化range已离开视窗、新range尚未paint的窗口；这再次排除“只是DOM数组为空”及应用issuer写入，但不把任何未审公共参数或组件修改说成唯一解。每帧JPEG、逐seed timeline、summary/oracle和trace均已在断言前持久化到独占output；白屏明确未关闭。

UX01/02的模型回归及真实Chromium已经闭合当前轨迹：真实tail预条件下向下wheel无位移不推进inputEpoch、不撤follow，下一append仍到尾；内容文字选择的原生鼠标拖拽自动滚到尾时保持browsing，后续append不抢位置且selection存活。首次浏览器运行的tail轨迹在列表尚差153px时错误断言“无位移”而失败，证据保留在`test-results/p1-input-intent-ux01-02`；修正为先用既有显式回底建立真实tail前置后，同源两条为2/2通过，目录`test-results/p1-input-intent-ux01-02-v2`。这不是延长等待或放宽UX断言。

UX04/05也已接入：零行只在attach/generation/messageCurrent/localReplica/head0共同证明`empty-known`时显示空账邀请；syncing/unknown/error互斥，不把错误或加载宣称为空。self actor未知且保存scope为Mine时诚实从All开始并提示；身份迟到只更新投影身份，列表key不含selfId、不重挂，仍保持All直到用户明确选择Mine。连同W5端口模型的定向一度为6 files/66 tests通过；这仍不是完整冻结套。

W5首次生产接线发生必须保留的事故。`useTaskEvidence`把当前`headSeq`作为每轮boundary；普通`system.log.query`又是有账本副作用的request/terminal。查询自身入Replica后推进head，hook effect因boundary变化cleanup/deactivate，controller在新round清verified、把`nextBeforeSeq`重置为`head+1`并立即schedule，于是每次查询结果都能触发下一次查询。用户真实页面连续看见root→system“提交了一项操作”及system“结构化结果11字段”；其raw结果head74991、related历史`actor.describe` 71182和`next_read=1500`，证明这不是正常正文。候选筛选虽已排除query自身，但分页发现还会读取`actor.describe`等非业务请求，扩大流量。

事故当时的第一步止血撤掉了`App.jsx`里的`useTaskEvidence` import/hook、`taskSnapshot`发布及`queryLog`解构，使生产没有`queryLog`调用者；已经提交的请求/迟到terminal照常入Replica，不删除、撤回或隐藏账本。随后§9.10.22进一步删除了`useChannelFeed.queryLog`/waiter/timeout本体，并以无写账、无第二cursor的纯projection重新接入既有history/live/checkpoint。故本段只保留事故顺序，不能再读成当前仍有惰性query候选；`system.log.query`自动读取继续禁止，也没有用UI过滤掩盖事故账本。

事故止血阶段曾补旧pending/abort隔离回归：挂起首次query后卸载hook、再让旧Promise迟到完成并耗尽timer，调用数保持1；端口层当时也证明Abort只脱离awaiter、迟到terminal仍入Replica。该3 files/13结果只解释为什么撤入口后不会继续提交，不能为query机制复权。当前生产状态已由§9.10.22取代：旧query controller/port已删除，W5改为只观察现有validated history/live/checkpoint的无写账projection。

同一轮“自动调用是否自激”审计还发现W6真实反例：`transmit`收到`closed/timeout`后把submission发布为`uncertain`并调用`onAccessChanged`，App据此推进`accessVersion`，原effect又把所有`uncertain`当可发送项。在wire持续open且每次返回`closed`的真实hook隔离中，同一稳定messageID在116ms内串行submit 6次；如果只给静态`onAccessChanged` spy则1秒仅1次，证明自激边是`failure → accessVersion → effect`而非pending自身。修订没有增加timer或第二retry controller：Outbox为每个durable ID记录已尝试的wire open epoch，同一连接代最多自动尝试一次，复用Wire本身的断线重连退避；真实`reconnecting→open`允许同ID再试一次，用户显式retry仍立即执行。before失败保留，after覆盖同open 1次、重连第2次、显式第3次且均同ID/maxConcurrent1；W6相关3 files/17 tests通过。

#### 9.10.19 生产runway的可承诺边界与超大raw记录反证

源码复核把三个数量分开：`history_before`的页是原始账本记录，Scheduler reservoir只是准备区，浏览中runway的`operation.next({count:8, byteLimit:256KiB})`才是一次可见释放边界。`release()`对首个超字节预算记录保留活性例外，因而该预算不是像素高度上界；无可见投影进展的过滤批次会在同一operation内让出一个浏览器task，但不冒充几何ready确认。另外，initial/focus仍有首32条/最大128条的独立释放边界，不受8条runway承诺覆盖。

有界生产fixture把第104回合的一条terminal正文扩大到180行且保持低于256KiB，依然通过真实`history_before → Scheduler → Replica → Presentation → MessageList`进入，没有直接向列表prepend。Presentation既有长文折叠将该raw正文变成一个507.09375px项（当时viewport 485px，有明确“展开全文”控件）。同一连续向上输入中三个runway intent分别以anchor 736/708/680完成，每次projection恰释放8条raw并到达708/680/652；95个DOM帧可见项从未为空，最多15个物化项，32个去掉固定状态槽与滚条的CDP compositor ROI帧前景均非空，应用issuer写入0。最终独占证据位于`test-results/p4-production-continuous-runway-r4-20260917/`；首轮把超长回合放在initial可见集而未触发runway的失败是fixture前置失败，不计为产品通过或白帧反例。

本轨迹只支持有界承诺：普通长文在可见插入前经稳定折叠，连续三批runway在该样本下不白且DOM有界。它不证明任意raw记录都有几何上界，也不覆盖用户主动展开长文、非文本异构内容、初始/focus较大释放，更不撤回原+30未知高直接prepend中已复现的compositor白帧。后者仍是组件提交顺序的硬回归；不用本次通过换取放宽或删除。

#### 9.10.20 前后台阅读连续性合同与失败候选A（未实施）

本轮撤回“后台准备好一份替代视图，然后交换”的描述。历史prepend不是换视图：已经可见的稳定row应继续存活，历史事件只有权在其上方增加older身份。数值`scrollTop`因保锚变化是必要几何，但背景尺寸确认没有权在新range coverage可用前先把原可见row移出物化窗口。

| 层/唯一owner | 可持有的事实 | 不可执行 |
|---|---|---|
| HistoryScheduler | validated page、IDB/reservoir、cursor/coverage、root-complete prepared segment | 不改阅读意图，不因page complete直接换可见窗口，不计算像素 |
| Replica | 已批准发布的不可变账本事实与稳定身份 | 不持scroll ref/跟随状态，不把背景reservoir冒充可见完成 |
| Presentation | 从批准事实生成稳定row/content/choice；将一个历史语义根准备成可有界交接的展示单元 | 不持像素尺寸树，不在可见范围反复分块，不改变已有block ID |
| ReadingSession | activation/mode/inputEpoch/frontier和真实向上需求；决定是否可以准入下一历史单元 | 不测高、不算偏差、不发`scrollBy`、不保存旧授权 |
| MessageList/Virtuoso | 唯一几何owner；公开`data + firstItemIndex`、物化range、测高、回收、原生scroll | 不从背景page直接得到数据；应用不向其叠加反向补偿或第二scroll owner |

事件权限是闭集：

| 事件 | 可改变的东西 | 不可改变的东西 |
|---|---|---|
| background page/cache完成 | reservoir、coverage、读取状态 | 当前Presentation rows、可见身份/Y、ReadingSession mode |
| 真实向上输入穿过frontier | 建立一个同activation/inputEpoch的前方扩展义务 | 不是无界drain授权，不使已可见row消失 |
| 同手势惯性/键盘继续上行 | 在上一单元已完成交接后按新frontier继续准入 | 停止/反向/切activation后不得沿用旧active证据 |
| native用户滚动 | Virtuoso按视口自然物化/回收 | 背景回调不得冒充这次运动 |
| live append（browsing） | 尾部事实与unseen | 不拉底、不回收当前可见row |
| 同ID content revision | 该content block及其尺寸 | 不换row ID；其他row不变 |
| 用户折叠/展开 | 被点击block尺寸，并进入browsing | 不自动follow；选择不丢 |
| 频道/scope/权限使view identity失效 | 整个Presentation激活集 | 旧activation不得晚写新view |

候选A曾提出`root-complete准备 → 单展示单元准入 → 首次List commit/range/height通知 → 下一单元`。它没有进入生产，现已由隔离反例否决：Virtuoso公开通知只表示一次中间进展，不表示该单元的最终实测覆盖完成。原子30项轨迹中首次`range/total-height`在sequence 53/54报告`scrollHeight=65771`，同一revision随后继续报告`68977 → 69949 → 70365 → 70392`；单个180行已展开root首次通知仍是估算的`61943`，后续才变为`70447`；折叠root也从`61943`再变`62186`。因此即使每次只加入一根，等第一对公开callback仍会让下一根与上一根的后续实测交错。不得把它包装为原子前台交接，也不再追求动态内容不存在的“永久最终尺寸”信号、settle次数或timeout。

修正前置后的有界样本中，逐根30项的首通知均出现（10–33ms），没有DOM空窗或真实全白；但整场5.3s且输入只在每5根间歇发生，不足以证明连续8–12ms原生手势的供给吞吐。原子30项在当前产品折叠样本也没有白帧，只说明这一个有界样本，不撤回生产硬oracle。迟到媒体轨迹最后一张被旧`darkPixels < 100`规则标作“白”，原图实际是铺满viewport的`#ddd`媒体块；内容连续性不能只靠暗像素阈值，原件保留但该帧不计白。有效产物为`test-results/admission-investigation-a-r2-20260917/`；遗漏initial稳定前置的首轮保留为不可判记录。

继续保留本节前半的owner和事件权限合同、现有reservoir隔离、稳定Presentation身份、单ReadingSession及唯一几何owner；撤销的只是“首range/height可作admission完成凭据”及其文件实施表。生产不得加入admission pending/ack状态、逐根gate或新buffer参数。原+30逐帧oracle与真实runway用例仍是后续方案的硬边界；B方案尚未结论，不据此迁库、fork或加第二补偿writer。

#### 9.10.21 原型C取舍与W4首个生产切片

原型C把虚拟range完全拿掉，仅保留稳定key真实DOM、normal flow和浏览器原生overflow anchor。普通DOM在静止+30、真实连续上滑+30、锚下+28、折叠clamp各2轮中均无compositor白帧、无DOM coverage空窗，selection节点/文本全存活；moving prepend当刻`row-7`保持同一`-192px`，说明该小样本的native anchor交接成立。但400行已有5429 elements和最大204ms long task；2000行27268 elements、最大1208ms long task、wheel round trip 76ms，不能扩写成100k可用方案。相同完整DOM仅加`content-visibility:auto`后，静止和moving prepend都2/2各出现一帧真全白，尽管rAF仍报告DOM覆盖；该支路已否决。完整环境、原图和raw记录见`docs/evidence/frontend-mechanism-c/REPORT.md`。这只证明“保留真实前台DOM”在小窗能避免本轨迹空paint，也证明全DOM/content-visibility两条直接实现各有不可接受代价；不批准迁架构、外补偿或放宽生产oracle。

在不等待列表机制实验的独立W4范围，ContentPlan首切片已经接入现有Markdown生产层，仍保持whole-message row和Virtuoso唯一列表几何。`content-plan.js`使用显式锁定的`unified@11.0.5`与`remark-parse@11.0.0`生成稳定top-level block ID、dependency revision与replacement；`MarkdownContent`从Timeline/progress/artifact收到稳定业务`contentKey`，用app-owned React key和memo保留sealed siblings，旧mount-local text-hash matcher删除。全局plan store上限128，render只准备不可变候选，只有layout effect确认DOM commit后才发布，避免被中断render污染后续remount。focused为5 files/30 tests passed，含真实DOM `isSameNode`与原生selection在active tail增长后存活；build 4361 modules / 2.46s通过。未完成边界仍是coarse多unit、Choices revision/CAS、bookmark按plan首次恢复及parser局部增量；本切片不能冒充W3白帧修复。

同一生产入口的窄browser复核中，数学/Markdown场景通过，fold原硬断言仍失败：按钮`201.1875→202.34375`。这次逐帧轨迹把新增ContentPlan DOM身份和既有几何族分开：collapse后的row/list高度已经稳定为`539.09375`，随后row高度不变，而整体列表`scrollHeight 3832→3834`、`maxScrollTop 3347→3349`、实际`scrollTop`仍3347，按钮和row一起再移动1.5px。折叠期间block DOM没有更换；现有证据不支持把这次失败归为ContentPlan wrapper重挂，也不能证明W4已修复fold。未改`≤1px`阈值，未增加Content滚动补偿或第二几何owner。

#### 9.10.22 W5无写账TaskEvidence阶段（历史；第二权威后续已删除）

W5事故后的生产止血已经从“没有调用者”推进为结构删除：`useChannelFeed`不再暴露`queryLog`，相关waiter、timeout、terminal settle及清理分支全部移除；已经存在或迟到的`system.log.query` terminal仍照常进入Replica，既不触发新submit，也不从账本或UI事实中删除。单一feed-owned Task projection现已进入生产，只观察Scheduler已验证的history页、Replica实际accepted的live rows，以及Scheduler接纳当前代coverage后的checkpoint；它没有请求、第二cursor、timer、retry或raw-page副本。

roster current不再由缓存存在或空Set推定。网络OBS完成后记录绑定`principalId + channelId + generation`的authority token；cache seed只提供展示候选，generation变化、注销、server-world重置及访问失效撤销旧权威，不完整OBS保持calibrating。Timeline把`taskRosterCurrent`作为actor incarnation门：未知时不能把旧queued画成当前任务，也不能把全集宣称为空。

WaitingLayer已保留projection完整性元数据。集合出现`overflow/historyStopped/omittedEvidence/contentTruncated/controlsTruncated`，或逐项`contentComplete/controlsComplete`为false时，UI显示明确partial/preview；不完整control不渲染edit/insert/cancel等动作，Replica命中完整turn后才恢复原控制。known且完整的queued路径不降级。App无条件用同一次`historyFor(activeChannel)`快照激活hook并把snapshot合入Timeline；断连或无正代attach会deactivate当前权威但保留cache staging，identity切换在render返回处同步核snapshot key，不能把A任务借B权限显示一帧。

**阶段反审纠正（随后已由§9.10.25修复）：** 上段当时只证明元数据和`controlsComplete=false`门；当时`readOnly`未同时要求`contentComplete`，所以`contentComplete=false, controlsComplete=true`仍可能开放编辑并把截断preview当`agentReplace.old_text`。该反例不能从95项定向结果推导为通过；其当前动作门和复验证据必须读取§9.10.25，不能把本段历史失败继续当作现状，也不能删除这条事故链。

该阶段定向证据为8 files/95 tests passed，build 4363 modules/2.32s。它曾覆盖无submit、部分terminal/generation/identity路径，但随后用户HMR zombie与第二权威审计否决此架构；这些数字只保留为历史反证输入，不能继承给后续canonical Replica→stateless WaitingPresentation实现。会写账本的自动查询继续禁止。

#### 9.10.23 Legend迁移失败、安全回退与并行反审

本轮中间态曾把Timeline唯一生产import切到Legend 3.3.11；P0-4真实Chromium随后0/3失败，用户wheel已把ReadingSession切为browsing而后续28帧仍被维持在gap=0。该失败是迁移否决证据，不是当前生产adapter的运行状态。19:42后稳定快照已经安全回退：Timeline仍导入误名`LegendMessageList.jsx`，但文件内部唯一import/render为`react-virtuoso`，`firstItemIndex`、`initialTopMostItemIndex`、`CommitAwareList`、`followOutput=false`、`rangeChanged`和`totalListHeightChanged`全部恢复。当前没有第二个生产adapter；`@legendapp/list`、Legend browser admission与fold-admission模型只是依赖/测试/证据残留，必须明确移除或隔离，不能继续宣称生产Legend。

迁移中间态的架构反例仍保留：Legend `maintainScrollAtEnd={false}`时，应用`issueBottomIfCurrent`在ResizeObserver/viewability/item-size/effect提示上直接DOM `scrollTo(scrollHeight)`，重现Legend规格§3.4已否决的B4连续tail方案；fold的应用token切MVCP size也未完成production gate。它们不能搬进未来Legend重试。当前Virtuoso回退只有一个应用`issueBottomIfCurrent` writer并在执行时重读committed session，未发现第二个应用writer；但这不关闭Virtuoso既有C1、下方增长+28、prepend/fold门。回退后仍须C1/append/stream/viewport/fold完整真实轨迹。

同轮反审还发现提交边界风险：`useReadingSession`在render期写入`sessionRef/snapshotRef/historyStatusRef/markReadRef`供异步history/timer读取，Timeline在render期写`readingControlRef`供已提交点击使用；被中断的render可能让未提交owner控制已提交界面。退出条件是owner只在layout/passive commit后发布，旧activation仍不能写新activation，并以中断/快速A→B→A反例回归。该缺口与列表选型正交，不能靠几何测试掩盖。

冷频道的命名三态在后续focused生产浏览器已3/3：following且有缓存行时解除presentation initialization遮挡但`bottomReady`继续守住follow授权；empty-known只在attached、同generation、message current、local replica ready与权威`headSeq=0`共同成立，协议/过滤batch不再误报“无相关”。独占轨迹中cache首paint约385.6ms、no-cache约109ms给稳定反馈且known>0/body pending不假空、known0约126.4ms显示权威空；未新增request/poller、后端或协议。该结果只取代本节先前2/3失败，不签署bookmark successor/predecessor/seq fallback、权限/错误、hidden paint-ready或完整初始化套。

本段早期“未显式操作的长文包括latest都折叠”语义已被后续审定撤回；它及当时3 files/22只能作为错误候选的历史证据。当前正确语义是权威current-entry无override时展开、失去角色且无override才折叠、override持久；模型36/36，但生产半迁移仍缺roleRevision + adapter public height ack，cache-first following/wheel takeover红。安全回退阶段真实Virtuoso gate的`330.34375→202.40625→disconnected`仍是历史失败证据，不能被模型绿覆盖。

`955d2e9d…`的旧0/7及其probe race只保留为阶段记录。唯一最终fuzz是final六hashv3：adapter`4f44e25e…`、useReading`c42567eb…`、Timeline`9e85d822…`、Composer`171a3559…`、useSubmissions`d4c1854f…`、test`ac1d0376…`，运行前后hash一致，命令使用独占15291/18951端口，结果**1 passed / 6 failed**。3 fixture均为following append gap519；2 integration均为同row connected但fold top从2185/2318跳到451.656；browsing send有intent1但writer0、gap1764未回底。唯一通过的following send有单intent、至多1 writer、mount后0 writer、gap0及四个submission phase。每case根timeline JSON、ROI、trace在`docs/evidence/conversation-ux-fuzz/final-four-9e85d822-v3/`。canonical CDP deep-history send2/2仍是独立窄证据，不能覆盖这6个失败。

#### 9.10.24 性能与资源定向审计（未冻结，未通过预算）

性能审计发生在共享树仍切换adapter期间，故只提供风险定位，不能继承到当前Virtuoso回退作验收。其当时Legend 100,000真实`snapshot.rows`样本首屏37 DOM行、中段45行、JS heap增量31.9MiB，真实中段paint hit与跨可见行selection成功；但安装同步415.6ms/最大long task 444ms，中段跳转long task 216ms，明确未过50ms响应门。100k字符/320 block Markdown位于2k列表尾时列表DOM只有17行，但单行高19,811px、元素3117、安装885.7ms/long task 933ms；这指向message内部coarse virtualization或worker/增量解析缺口，不能靠微调buffer签过。

独立纯Node当前ContentPlan样本为128,888 chars/2,500 blocks：首次约426ms、尾append约276ms。前2499个block ID稳定只证明身份复用，解析仍是全量remark parse，不能写成parser局部增量或长文CPU门通过。

同轮huge-history App样本cold首行2016.5ms、warm 1302.1ms，DOM均15，heap增量21.8/20.9MiB，cache由156→194行、56→70KiB；最大long task仍为288/247ms。390×844移动样本12次历史拉取后DOM19、heap 23.3MiB、cache 268行/95KiB，但连续释放双周期证据未完成。Waiting mock在第9项返回`base_capacity`只说明该mock夹具约8项，**不是产品上界**；当前树phase-c C-BR-06/08在第二个请求后等待region 10秒未出现，waiting性能/DOM证据被功能回归阻断，保持开放。上述均为定向、非冻结、非发布证据；回退后完整性能套仍未运行。

后续在当前Virtuoso回退链上的定向复测取代“没有当前adapter数据”，但仍不是release签署。20:08 freeze后100k exact row50000真实物化/paint/hit/selection通过：41→62行、509 DOM elements、heap +26.7MiB，最大long task114ms；waiting active+8/collapse/expand也通过，275 elements、最大long task143ms。100k chars/320 blocks单条仍高19,811px、2,989 elements、最大long task911ms；cold/warm为2668/1787ms、最大long task186/176ms；390×844移动双周期最大397ms/180个long tasks。灾难安全与这两条功能P0可以记定向绿，50ms响应门及长文CPU仍红；详账见`docs/PERFORMANCE-RESOURCE-AUDIT-20260917.md`。

#### 9.10.25 W5 Waiting旧queued复活的TaskEvidence修复阶段（历史；方案已撤销）

重构前基线只有materialized `state.turns`能进入Waiting，Timeline直接以
`_timelineControlVersion`重算；response-before-request尚无turn，因此也不可能先生成
一个等待项。W5引入feed-owned detached task snapshot后，旧queued可以先作为独立
来源显示，但最终join仍只订阅generic control revision。terminal/processing先于request
到达时，Fold只把事实写入`_unmatchedByParent`，没有推进该memo依赖，于是纯projection
已经能否决旧queued，已挂载的同一Timeline DOM却继续复用旧memo。丢失点是W5把
第二生命周期来源接入Timeline时没有同时建立覆盖unmatched事实的订阅，并非Gateway、
history或live拒绝了terminal。

修复在Fold建立统一、只增的`_taskEvidenceRevision`：task request、matched queued/
processing控制变化、任一final、unmatched queued/processing/final以及memory trim都会推进；
正文token帧不推进。Timeline的task-evidence memo以该revision和冻结snapshot身份完成
最终join。Replica中的terminal/processing因此可在snapshot仍旧为queued的同一次DOM
生命周期内立即移除等待项；随后到达的旧queued、旧request或旧generation snapshot均
不能复活它。completed/failed/dismissed/replaced/processing五类same-DOM矩阵、真实
feed→hook→Timeline链和`wire.submit=0`均有定向回归。此机制只读现有validated
Scheduler history、accepted live、checkpoint与Replica；不得恢复`system.log.query`、
后台request、第二cursor或用UI隐藏项代替事实合并。

不完整证据的动作门同时收紧：edit及其附件编辑入口要求`contentComplete &&
controlsComplete`；insert/cancel/其他控制只要求`controlsComplete`。缺正文继续等待既有
materialize，不触发新查询。

同一P0随后由真实Chromium揭出两个独立入口缺口。第一，Task projection曾从actor id
前缀猜kind，真实旧频道的opaque `steward`因此在request入口被丢：Replica已经因queued
把它移出主列表，但task snapshot没有item，Waiting从未挂载。现在task word只接纳唯一
非空audience，最终仍由当前代权威roster Set分类，未放宽actor currentness。原失败的
phase-c C-BR-06/08已恢复通过；canonical `agent:steward:test`的真实browser轨迹也记录
同一requestId对应Waiting DOM挂载，completed terminal后原node断开且无replacement。

第二，容量压力进入`historyStopped`后，旧实现丢弃后续非live页正文，却继续合并coverage
和freshness；前页retained queued可在后页terminal未处理的情况下被错误认证为current。
修复把stopped状态定义成有界lifecycle-only：不再分配request body或未知orphan，只对
已retained/evicted记录继续折叠queued/processing/final，再允许相同validated coverage
推进。completed/failed/dismissed/replaced跨页反例均先红后绿，迟到旧页不复活；集合
继续保持partial，未用UI过滤掩盖旧claim。

以上修复与7 files/89、三条具名Chromium只覆盖当时的fresh activation。用户随后在HMR页面
看到zombie，源码审计又确认TaskEvidence是canonical Replica之外的第二生命周期权威，故该方案
整体撤销，ControlDiscovery/四端口候选也不准入。root随后审定目标为Gateway validated事实只
进入canonical Replica fold，stateless WaitingPresentation从Replica turn派生WaitingLayer，且
HistoryScheduler不产生Waiting专用输出。当前完成与证据状态等待root归一矩阵；原位HMR、
existing-cache cold reload与真实browser仍须重签，不能把手动刷新作为解决办法。

#### 9.10.26 当前收敛快照（未冻结、非完整验收）

W1/W2新增两组具名定向：cold cache/no-cache/known0生产Chromium3/3，关联unit
3 files/33与build通过；`historyDemand`同一revision跨至少两个physical batch的生产
Chromium1/1（最终复签约23.3s），loading/history/read 3 files/60及channel-switch11/11通过。前者不签权限/错误、hidden
paint-ready与非exact bookmark fallback；后者只签operation→physical batch的呈现稳定性。
两者都只使用既有`channel_meta/history_before`与单Scheduler，没有后端、协议、poller或
第二request owner。

W6最终pure transaction按exact target与snapshot list revision/rowIDs/height双序join，waiting
只记exact inserted，A/B并存，takeover/activation清；无timer/rAF补偿/private patch。final四hash
production CDP repeat2 2/2，每条1 send-start intent、1 writer，outbox/transmit/receipt/feed各1；
trusted wheel后18/19 ordinary-stream issuer均not-authorized且零二写。数据focused25/25，故W6
发送/Outbox窄范围关闭；此前双写与过宽token只保留为修复输入，不再是当前缺陷。

W7在final四hash的CDP send中确认Waiting mount与唯一writer同帧，promote/completed后仍保持
browsing gap2135；但旧waiting测试当前1/2红，原因是未立即takeover，随后ordinary follow加
Virtuoso scrollBy。FINAL6旧SHA2/2只保留为零外框漂移证据，不能替当前完整几何背书。

final四hash为Timeline`9e85d822…`、useReading`c42567eb…`、adapter`4f44e25e…`、txn
`ac6dea2b…`。focused67/67+build、filter first-frame2/2、C1/takeover4/4、CDP send2/2及+28
1/1绿；prepend 4101–03各一白帧，bookmark unmaterialized/Infinity，fold collapse control absent，
旧waiting1/2红；最终六hash fuzz v3为1/7，仅following-send通过。状态机focused/build不能替代这些几何门。

当前W4/W5施工前的最近完整unit边界有同次JSON：289/289 suites、843/843 tests、integrity contract 4/4，零失败/exit0；
shared Virtuoso mock/固定伪几何已删除，3个旧模块引用已迁移，`docs/evidence/**`不再被
Vitest误收集，diff-check clean。此前805/828与804/828只保留为共享树未冻结阶段的失败
快照。该结果关闭当时源码的unit门，但当前W4/W5生产变更后必须重跑；也没有一轮同freeze完整
browser/fuzz/build总账。不得把旧unit绿外推为现树或系统交付。此节及§0取代前文任何“当前只剩验收”
或拼接阶段证据的读法。

最终六hashv3 fuzz前后指纹一致，结果1/7：3条following append gap519、2条fold top大跳、
1条browsing send intent1/writer0/gap1764失败；只有following send通过。artifact在
`docs/evidence/conversation-ux-fuzz/final-four-9e85d822-v3/`。它与canonical CDP send2/2
共同证明发送producer窄门通过但列表/场景仍红；完整browser/build仍无同freeze总账。
