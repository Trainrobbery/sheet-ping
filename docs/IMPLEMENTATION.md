# 구현 기록 — 0.4.0-alpha.2

기준 환경: Foundry 13.351, dnd5e 5.3.3, 공식 CharacterActorSheet / NPCActorSheet. Tidy 제외.
이번 변경: Z 입력 전환, Shift 복원, 토큰·고양감·화폐, 관찰자 지목 옵션.
alpha.2 추가: 플레이어 이름 앞에 사용자 지정 색상의 ● 표시.
alpha.3 추가: 입력 방식 선택, 기본 휠 클릭.

## alpha.3 이후 추가

인벤토리 수치·용기·조율, 탈진·죽음 내성, 캐릭터 이름 굵게, 간결한 AC 문구, 토큰 지목의 카메라 이동 없는 기본 핑을 추가했습니다.

## 확인한 공식 자료

dnd5e 코드는 모두 **release-5.3.3** 태그를 기준으로 읽었습니다.

| 자료 | 구현 근거 |
|---|---|
| [dnd5e.mjs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/dnd5e.mjs) | 공개 시트 클래스 경로 |
| [character-sheet.mjs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/applications/actor/character-sheet.mjs) | 고양감 토글의 submit 호출과 사이드바 최대 속도 선택 규칙 |
| [character-header.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/character-header.hbs) | 고양감 button.inspiration, data-action=toggleInspiration |
| [character-sidebar.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/character-sidebar.hbs) | HP·우선권·속도·숙련·AC 위치 |
| [character-ability-scores.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/character-ability-scores.hbs) | 능력치 이름·점수·수정치 |
| [character-details.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/tabs/character-details.hbs) | 기술·내성 위치 |
| [character-inventory.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/tabs/character-inventory.hbs) | 무게·근력·크기·배율 표시 |
| [containers.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/inventory/containers.hbs) / [encumbrance.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/inventory/encumbrance.hbs) | 용기 아이콘과 무게 막대 |
| [inventory.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/inventory/inventory.hbs) | 화폐 라벨·아이콘·입력란, 돈 관리 버튼, 아이템 제목 |
| [character.mjs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/character.mjs) | attributes.inspiration의 Boolean 스키마 |
| [attributes.mjs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/actor/templates/attributes.mjs) | hp.effectiveMax와 준비된 수치 |
| [base-actor-sheet.mjs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/applications/actor/api/base-actor-sheet.mjs) | 공식 click 굴림·HP 조정 처리와 save.value/skill.total |
| [spell.mjs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/item/spell.mjs) | method/prepared |
| [identifiable.mjs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/item/templates/identifiable.mjs) | 미식별 공개용 이름 |
| [Foundry v13 TokenLayer](https://foundryvtt.com/api/v13/classes/foundry.canvas.layers.TokenLayer.html) | 현재 hover 객체와 active |
| [Foundry v13 Token](https://foundryvtt.com/api/v13/classes/foundry.canvas.placeables.Token.html) | isVisible/isPreview, document, bounds |
| [Foundry v13 Canvas](https://foundryvtt.com/api/v13/classes/foundry.canvas.Canvas.html) | app.view, canvasCoordinatesFromClient, canvasTearDown |
| [DocumentSheetV2](https://foundryvtt.com/api/v13/classes/foundry.applications.api.DocumentSheetV2.html) | 읽기 전용 시트의 form 필드 비활성화 가능성 |
| [User](https://foundryvtt.com/api/v13/classes/foundry.documents.User.html) / [Color](https://foundryvtt.com/api/v13/classes/foundry.utils.Color.html) | 사용자 color 필드와 Color.css 표현 |
| [renderApplicationV2](https://foundryvtt.com/api/v13/functions/hookEvents.renderApplicationV2.html) / [renderChatMessageHTML](https://foundryvtt.com/api/v13/functions/hookEvents.renderChatMessageHTML.html) | 시트·채팅 DOM 확장 |

## 입력과 생명주기

- window 캡처 keydown/keyup에서 물리 KeyZ 상태만 추적합니다. 키보드 이벤트를 취소하지 않습니다.
- 타이핑·조합 중 입력·혼합 modifier는 제외하고 blur·숨김·편집 필드 포커스·장면 teardown에서 상태를 초기화합니다.
- 시트는 Actor 유형과 일치하는 정확한 공식 CharacterActorSheet/NPCActorSheet 클래스만 허용합니다. inputMode에 따라 가운데 버튼 또는 Z 단독 좌클릭과 명시한 타깃일 때만 차단합니다.
- 가운데 버튼은 pointerdown/mousedown에서 기본 동작을 취소하고 auxclick에서 한 번 전송합니다. 좌클릭의 기존 기능과 wheel 스크롤은 유지합니다.
- inputMode는 클라이언트 String 설정이며 기본 middle, 선택값 middle/zClick입니다. 기존 zEnabled는 입력 활성화 상태를 유지하기 위한 저장 키이며 UI 이름은 지목 입력 사용으로 변경했습니다.
- **Shift가 눌린 이벤트는 Z 상태와 관계없이 가로채지 않습니다.** 이전 shiftEnabled 설정·Shift 핸들러를 유지하지 않습니다.
- 시트 재렌더/닫기 시 기존 리스너를 제거합니다. 문서 프로토타입과 시스템 메서드는 덮어쓰지 않습니다.
- disabled 고양감 버튼은 활성화하지 않고 옆에 상태 span을 추가합니다. 재렌더 때 재작성하며, 상태 토글·문서 권한은 그대로 둡니다.

## 캔버스 토큰과 빈 지점

- window의 DOM 포인터 캡처에서 canvas.app.view를 대상으로 할 때만 동작합니다.
- 활성 토큰 레이어의 hover 토큰, 가시성, 현재 Scene, 좌표 변환 후 bounds를 확인합니다.
- 마우스 누름은 차단해 native 선택·드래그 시작을 막고, 같은 토큰에서 마우스를 뗐을 때 한 번 전송합니다. 빈 지점은 같은 장면의 캔버스 안에서 뗐을 때 좌표를 한 번 전송합니다.
- 6px 초과 이동, 입력 방식 변경, 포인터 취소, blur, 장면 변경은 전송을 취소합니다. Z 모드에서만 Z 해제를 확인합니다. 시작 버튼을 기억해 호환 mousedown/up/click/auxclick 이벤트에서 중복 전송하지 않습니다.
- 토큰 이름 지목은 Actor를 읽지 않습니다. 현재 보이는 토큰의 이름을 지목하므로 시트의 관찰자 옵션과 별도로 동작합니다.
- 비GM에게 숨겨진 토큰은 제외하며 GM은 자신에게 보이는 숨김 토큰도 지목할 수 있습니다.
- 이 부분은 공개 API에 근거한 설계입니다. 실제 PIXI 이벤트 순서·다른 모듈 조합의 검증은 미완료입니다.

## 권한과 스냅샷

- 캐릭터·NPC 시트는 GM/소유자를 허용하고, allowObserverPings가 켜져 있으면 OBSERVER를 추가로 허용합니다. 기본값은 true입니다.
- LIMITED/권한 없음·컴펜디엄은 제외하고 아이템은 별도 OBSERVER 검사를 통과해야 합니다.
- 관찰자 정책은 전송 시점에 다시 읽습니다. 문서 소유권을 변경하지 않습니다.
- HP=value/effectiveMax, 우선권=init.total, 숙련=prof, AC=ac.value, 속도=숨겨지지 않은 이동 방식의 최대값을 사용합니다.
- 고양감은 Boolean만 허용합니다. 화폐는 system.currency의 저장값과 CONFIG.DND5E.currencies 라벨을 사용합니다. 환산·수정·저장 전 입력값 읽기를 하지 않습니다.
- 스냅샷은 flags.sheet-ping.snapshot에 저장합니다. 기존 종류는 보존하며 inspiration에 available/status, currency에 amounts[{code,amount,label}], token에 tokenUuid/tokenName을 추가했습니다.
- 토큰 스냅샷에는 actorName/actorUuid를 넣지 않습니다. 과거 메시지를 다시 계산하거나 수정하지 않습니다.
- HTML과 Foundry 인리치 구문을 이스케이프합니다. 미식별 아이템은 GM도 공개용 이름만 사용합니다.
- 표준 ChatMessage.create로 전체 공개 메시지를 한 번 생성하며 소켓·권한 변경·게임 데이터 변경은 없습니다.

## 인벤토리·상태 데이터

- weight는 attributes.encumbrance.value/max, 크기 보정률은 encumbrance.mod를 사용합니다. weight 단위는 dnd5e.metricWeightUnits 설정과 CONFIG.DND5E.encumbrance.baseUnits/weightUnits에서 읽습니다.
- 크기 명칭은 traits.size와 CONFIG.DND5E.actorSizes를 사용하며 근력은 기존 ability(str) 지목을 재사용합니다.
- 용기 아이콘은 해당 Item ID로 기존 아이템 지목 서비스에 전달하므로 원본 부모·권한·미식별 이름 보호를 동일하게 적용합니다.
- attunement는 attributes.attunement.value/max, exhaustion은 attributes.exhaustion, deathProgress는 attributes.death.success/failure를 읽습니다. 공식 5.3.3 시트의 3개 점을 기준으로 성공과 실패를 함께 표시합니다.
- 지정된 상태 점/죽음 내성 버튼에서만 지목 이벤트를 차단합니다. 일반 클릭은 기존 토글·굴림을 유지합니다. 입력란과 설정 버튼은 제외합니다.
- formatter에서 actor 이름을 먼저 HTML 이스케이프한 뒤 strong으로 감싸므로 한국어·영어의 모든 시트 문구에 일관되게 적용됩니다. AC 문구의 조사와 서술부를 제거했습니다.

## 토큰 지도 핑

- 빈 지점은 마우스를 뗀 시점의 client 좌표를 canvas 좌표로 변환합니다. 토큰은 Token.center를 사용하며 TokenDocument.getCenterPoint를 대체 경로로 사용합니다. 채팅을 기다리기 전에 좌표를 복사하여 효과 위치를 확정합니다.
- 채팅 생성 성공 후 [User.broadcastActivity](https://foundryvtt.com/api/v13/classes/foundry.documents.User.html)로 native ping 활동을 전달하고 [ControlsLayer.handlePing](https://foundryvtt.com/api/v13/classes/foundry.canvas.layers.ControlsLayer.html)으로 로컬에도 표시합니다.
- [PingData](https://foundryvtt.com/api/v13/interfaces/foundry.canvas.interaction.types.PingData.html)에 scene, style=chevron, pull=false, zoom을 명시합니다. 사용자 객체를 handlePing에 전달해 플레이어 색상을 사용합니다.
- [공식 핑 안내](https://foundryvtt.com/article/pings/)의 Shift 길게 클릭 형태를 사용하되 카메라 pull은 비활성화합니다. Canvas.ping의 자동 modifier 추론을 사용하지 않아 채팅 생성 대기 중 Shift 상태가 바뀌어도 카메라를 끌지 않습니다.
- 새 소켓 채널이나 별도 애니메이션을 만들지 않습니다. 성공한 채팅은 효과 실패 때문에 재전송하지 않습니다. 효과 실행 전 현재 장면을 다시 확인합니다.

## 다음 검증

84개 자동 테스트와 문법·JSON·ZIP 검사 결과는 TEST-REPORT.md에 기록했습니다.
실제 Foundry, 관찰자 시트의 disabled 버튼, PIXI 포인터 순서, 멀티플레이·다른 자동화 모듈과의 충돌을 추가 확인해야 합니다.

## 플레이어 색상 기호

시트·토큰이 공통으로 호출하는 createPingMessage에서 발신자의 user.color를 읽고 Color.css 또는 16진 문자열을 정규화하여 snapshot.userColor에 저장합니다.
formatter는 플레이어 이름 앞에 별도 span의 ●를 넣고, 해당 span에만 검증한 색상을 적용합니다. 이름과 본문은 기존 색상을 유지합니다.
허용 색상은 3자리/6자리 16진 값이며 유효한 색상이 없으면 currentColor를 사용합니다. 스냅샷 원본과 과거 채팅을 수정하지 않습니다.

## 휠 클릭 근거

[Foundry v13 ClientSettings](https://foundryvtt.com/api/v13/classes/foundry.helpers.ClientSettings.html)의 choices 설정과 [MDN auxclick](https://developer.mozilla.org/en-US/docs/Web/API/Element/auxclick_event), [W3C Pointer Events](https://www.w3.org/TR/pointerevents/)를 확인했습니다.
가운데 버튼의 기본 동작을 막으려면 auxclick뿐 아니라 down 이벤트도 취소해야 하므로 두 단계를 구분했습니다. 실제 브라우저/Foundry 이벤트 흐름은 추가 확인이 필요합니다.

## 지점과 채팅 링크 — alpha.2

- `point` 스냅샷에는 sceneId와 position {x,y}를 복사해 저장합니다. 토큰 링크는 기존 tokenUuid를 그대로 사용합니다.
- formatter에서 한 지점 / a point 또는 이스케이프한 토큰 이름만 `a.sheet-ping-map-link`로 감쌉니다. 목적지 데이터는 href나 HTML 속성에서 읽지 않습니다.
- 채팅 렌더 훅에서 리스너를 연결하고 같은 DOM 재렌더 때 기존 리스너를 제거합니다. href 기본 동작을 취소하여 페이지 상단으로 이동하지 않습니다. Enter 활성화도 일반 click으로 처리합니다.
- navigation은 flags의 스냅샷과 현재 Scene 컬렉션을 조회합니다. GM, 활성 장면, OBSERVER 중 해당하는 경우에만 열람을 허용하고, 다른 장면이면 공개 [Scene.view](https://foundryvtt.com/api/v13/classes/foundry.documents.Scene.html#view)를 호출합니다. activate/pullUsers는 호출하지 않습니다.
- 지점은 저장된 좌표, 토큰은 현재 canvas.tokens.get의 객체 중심으로 이동합니다. 토큰의 Actor를 읽지 않으며 삭제/hidden/isVisible/isPreview/UUID 일치를 확인합니다. 옛 토큰 좌표로 대체하지 않습니다.
- 공개 [Canvas.animatePan](https://foundryvtt.com/api/v13/classes/foundry.canvas.Canvas.html#animatePan)에 x/y/duration만 전달하여 로컬 카메라를 이동하고 확대 배율을 보존합니다. 목적지 장면이 준비되었는지도 다시 확인합니다.
- 토큰 중심은 공개 [Token.center](https://foundryvtt.com/api/v13/classes/foundry.canvas.placeables.Token.html#center) 및 [TokenDocument.getCenterPoint](https://foundryvtt.com/api/v13/classes/foundry.documents.TokenDocument.html#getCenterPoint)에 근거합니다.
- v13 공개 API 문서는 현재 13.350으로 표시됩니다. 대상 13.351에서 실제 호출·권한·장면 전환을 실행한 검증은 별도로 필요합니다.

## 주문 시전 카드와 이동 기호 — alpha.3

- [creature-spells.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/tabs/creature-spells.hbs)의 주문 탭 `.top > .spellcasting.card` 아래 `.info`의 ability/attack/save 라벨과 value만 지목합니다.
- 공식 [CharacterActorSheet._prepareSpellsContext](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/applications/actor/character-sheet.mjs)와 같은 레벨 내림차순·안정 정렬로 카드를 Class Item에 연결합니다. 카드의 data-ability와 전체 개수를 검증하고, Class ID만 DOM 데이터 속성에 부여합니다. 재렌더 때 기존 연결을 지운 후 재작성합니다.
- 스냅샷 생성 시 클래스가 Actor.items와 Actor.spellcastingClasses 모두에 속하는지, 부모 Actor UUID와 능력이 일치하는지, 아이템 열람 권한이 있는지 확인합니다. 클래스가 삭제·이동·변경되면 추정하지 않고 실패합니다.
- spellAbility는 actor.system.abilities[클래스 능력].mod, spellAttack은 item.spellcasting.attack, spellDC는 item.spellcasting.save입니다. [SpellcastingField.prepareData](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/data/item/fields/spellcasting-field.mjs)의 준비된 보너스/DC를 사용하며 재계산·굴림을 하지 않습니다.
- source 이름은 공식 시트와 같은 progression 비교로 Class 또는 Subclass를 선택합니다. 서브클래스 이름을 사용할 때도 열람 권한을 확인합니다. 같은 능력을 사용하는 여러 클래스도 Item ID로 구분합니다.
- 새 시트 문구의 actor/source/label은 각각 이스케이프하며 캐릭터 이름은 기존과 같이 strong으로 표시합니다. 클래스 Item UUID와 선택한 능력을 스냅샷에 저장합니다.
- 대표 능력 설정 버튼, 준비 개수, 카드 제목은 대상에서 제외합니다. 원래의 클릭·입력과 시스템 상태는 유지합니다.
- formatter의 지도 링크에 `span.sheet-ping-map-icon`의 ⊕를 추가합니다. 장식 기호는 aria-hidden=true이며 링크 제목의 위치 이동 안내와 동일한 클릭 처리를 사용합니다. 발신자 색상의 ●는 그대로 유지합니다.

## 이동 기호 제거 — alpha.4

- formatter의 지도 링크에서 기호 span을 제거했습니다.
- 채팅 렌더 시 alpha.3 메시지의 기존 sheet-ping-map-icon과 그 앞의 추가 공백을 제거합니다. 저장된 메시지를 업데이트하지 않습니다. 링크와 툴팁, 키보드 포커스는 기존 경로를 사용합니다.

## NPC 시트 — 0.4.0-alpha.1

공식 release-5.3.3의 다음 소스를 확인했습니다.

- [npc-sheet.mjs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/applications/actor/npc-sheet.mjs): 공개 NPCActorSheet, 헤더/사이드바/주문 렌더 문맥, 첫 시전 클래스 선택, 속도 목록 순서.
- [npc-header.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/npc-header.hbs): HP·AC·initiative/initiative-score·proficiency·creature-size·ability-score/save-tab·death-saves.
- [npc-sidebar.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/npc-sidebar.hbs) / [actor-trait-pills.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/parts/actor-trait-pills.hbs): 기술/속도/장비 pill 구조.
- [actor-features.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/tabs/actor-features.hbs) / [actor-inventory.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/tabs/actor-inventory.hbs): 공통 dnd5e-inventory 사용.
- [creature-spells.hbs](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/templates/actors/tabs/creature-spells.hbs): NPC 단일 주문 카드, select/수치 분리.

NPC 전용 선택자는 npc-targets.mjs에 두고, 공통 대상은 targets.mjs를 사용합니다. ability-save는 일반 ability 판별보다 먼저 해석해 내성을 능력치로 오인하지 않습니다. 입력란·설정·proficiency-cycle은 기존 제외 규칙을 먼저 적용합니다. 죽음 내성 굴림 버튼만 지정한 예외로 차단합니다.

NPC 속도 pill에는 수치 이동 방식 순서대로 data-sheet-ping-movement-type을 연결합니다. hidden/0인 방식과 자유 서술형 special 문구는 연결하지 않습니다. 지목 시 선택한 방식의 준비된 수치와 CONFIG 단위를 읽습니다. PC의 최대 속도 선택은 유지합니다.

NPC 주문 카드는 클래스가 없어도 렌더됩니다. 공격 값은 시트 렌더 시 simplifyBonus로 보너스를 평가한 결과이며 Actor의 대표 spell.attack과 다를 수 있습니다. 지목 시 read-only .value 텍스트의 유한 숫자를 읽고, 선택한 능력과 첫 주문 시전 클래스 연결 및 권한을 검사합니다. 수식·입력값·Roll을 평가하지 않고 snapshot.valueSource=sheetDisplay로 출처를 기록합니다. 원래 렌더의 표시값이 바뀌면 다음 클릭은 새 표시값을 저장합니다.

NPC 무기는 attack 메시지로 분류하며 아이템 ID/권한/미식별 이름 보호를 적용합니다. initiativeScore는 init.score, 기존 initiative는 init.total입니다. NPC 이름도 actor 공통 formatter에서 굵게 표시합니다.

NPC 시트에 표시되지 않는 PC 전용 필드를 생성하지 않습니다. CR·전설적 행동 점·감각·저항/면역·설명·활동·소모 컨트롤은 이번 대상에 포함하지 않았습니다.

## URL 설치와 릴리스 — 0.4.0-alpha.2

- manifest: https://raw.githubusercontent.com/Trainrobbery/sheet-ping/main/module.json
- download: https://github.com/Trainrobbery/sheet-ping/releases/download/v0.4.0-alpha.2/sheet-ping.zip
- tools/package.py --release는 dist/sheet-ping.zip과 동일한 dist/module.json을 만듭니다. 설치 ZIP의 최상위에 module.json을 넣고 런타임·README·변경 기록을 포함하며 테스트/도구/CI/문서는 제외합니다.
- main에서 module.json을 갱신하면 release.yml이 실행됩니다. 검증, 패키징, 초안에 두 파일 업로드, 게시, 익명 다운로드의 순서로 진행합니다. 릴리스는 버전 태그에 고정하며 이미 게시한 버전의 파일을 교체하지 않습니다.
- 알파 버전은 prerelease로 표시합니다. GitHub latest 별칭 대신 고정 raw 매니페스트로 설치/업데이트를 제공합니다.
- 게시 후 설치 파일 두 개의 익명 다운로드, ZIP SHA-256 일치, module.json 내용·압축 무결성을 배포 작업에서 확인합니다. 실제 FVTT 설치 클라이언트 실행은 별도입니다.
