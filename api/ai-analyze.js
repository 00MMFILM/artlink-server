import Anthropic from "@anthropic-ai/sdk";
import {
  checkAppToken,
  rejectAppToken,
  identifyUser,
  checkTextQuota,
  consumeText,
  identifyGuest,
  checkGuestQuota,
  consumeGuest,
} from "./_usage.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 생성 메타 — 노트에 함께 저장되어 나중에 품질 비교·학습 데이터 필터의 기준이 된다
const MODEL = "claude-sonnet-4-6";
const PROMPT_VERSION = "2026-08-13.1";

// 참고: 동적 예시(training_data 자동 삽입)는 제거함 (2026-08-06).
// 검수 안 된 유저 피드백이 표준 예시가 되는 자기오염 문제 —
// 대신 아래 FEW_SHOT_EXAMPLES(검수된 고정 예시)만 사용. training_data 수집 자체는 계속.

const FEW_SHOT_EXAMPLES = {
  acting: `[좋은 피드백 예시]
📌 오늘 독백 연습에서 감정의 레이어가 한층 깊어졌어요. 대사 아래 숨겨진 캐릭터의 불안이 자연스럽게 드러나고 있습니다. 특히 중반부에서 감정의 소분류가 '#담담하게'에서 '#울먹이듯'으로 전환되는 순간이 인상적이에요.

💪 "그건 내 잘못이 아니야"를 말할 때 목소리가 미세하게 떨리면서도 눈빛은 단호한 점이 훌륭해요. 이 모순이 캐릭터의 내면 갈등을 압축적으로 보여줍니다. 골반 중심축이 안정된 상태에서 상체만으로 감정을 표현하는 절제력이 느껴져요. 마이즈너의 '반복 연습(Repetition Exercise)'에서 추구하는 충동적 진실성이 잘 드러나고 있어요.

🎯 세 번째 비트 전환에서 감정이 급격히 바뀌는데, 호흡으로 브릿지를 만들어보세요. 들숨에서 감정을 전환하면 관객도 함께 전환할 시간을 얻어요. 현재 전환이 '#격앙된'에서 바로 '#속삭이듯'으로 넘어가는데, 그 사이에 '#떨리는' 단계를 거치면 감정 곡선이 더 유기적이 됩니다. 프로소디 관점에서 이 전환 지점의 피치를 의도적으로 낮추고(pitch down), 속도를 0.7배로 감속하면서 0.5초 쉼을 넣어보세요.

🎭 스타니슬랍스키의 '마법의 만약에'를 적용해보면 — 만약 이 대사가 마지막이라면 어떤 무게감이 실릴까요? 서브텍스트 작업에 도움이 됩니다. 현재 캐릭터의 음성 시그니처가 중저음 음역대에 빠른 리듬인데, 같은 대사를 고음역+느린 리듬으로 전달했을 때의 차이를 실험해보세요. 우타 하겐의 '전이(Transference)' 기법도 추천해요. 실제 자신의 기억에서 유사한 감정을 끌어와 캐릭터에 입히는 방식이에요.

🎨 이 독백의 감정 구조는 봉준호 감독의 '기생충'에서 기택(송강호)이 지하실에서 올라오는 장면과 닮아 있어요. 억눌린 감정이 신체를 통해 서서히 스며나오는 방식을 참고해보세요.

💡 무용의 라반 분석에서 '무게(Weight)' 개념을 빌려오면 재미있어요. 대사마다 무게감을 다르게 싣는 연습을 해보세요. 척추의 각 마디를 의식하면서 감정이 어디에서 시작되는지 탐색하면 신체적 표현의 폭이 넓어집니다.

📈 지난번 대비 비트 전환이 더 유기적이에요. 특히 감정 곡선의 정점에서 '쉼'을 가져가는 용기가 생긴 게 보여요. 이전에는 감정 대분류(기쁨→슬픔) 수준의 전환이었다면, 이제는 소분류(#담담하게→#울먹이듯→#격앙된) 수준의 미세한 그라데이션이 나타나고 있어요. 음성 톤도 이전의 단조로운 리듬에서 벗어나 프로소디의 변화폭이 넓어졌어요 — 쉼 타이밍, 피치 변동, 속도 완급이 더 자유로워졌습니다.

🔜 같은 독백을 앉아서 → 서서 → 걸으면서 3번 해보세요. 신체 상태에 따라 골반-척추-어깨의 정렬이 바뀌면서 감정이 어떻게 달라지는지 관찰하면 새로운 층위를 발견할 수 있어요.`,

  music: `[좋은 피드백 예시]
📌 오늘 연습에서 프레이즈 끝처리가 눈에 띄게 정돈됐어요. 특히 하행 스케일의 레가토 연결에서 음과 음 사이의 공기가 사라지고 한 호흡의 선율로 들리기 시작했습니다. 다이내믹 설계도 이전보다 의도가 분명해요.

💪 16분음표 패시지에서 왼손 독립성이 좋아요. 세 번째 마디의 크로스오버가 매끄럽고 음량이 균일합니다. 보컬 관점에서는 흉성(chest voice)의 안정감 위에서 파사지오(passaggio, 음역 전환 구간)를 믹스보이스로 통과하는 브릿지가 자연스러워요. 고음에서 후두가 따라 올라가지 않고 버티는 건 기본기가 잡혔다는 신호입니다.

🎯 포르테에서 피아니시모로 떨어질 때 전환이 급격해요. 2-3박에 걸친 디미누엔도 브릿지를 설계해보세요. 벨팅(belting)에서 브레시(breathy) 톤으로 넘어갈 땐 0.5박 정도 가성(falsetto)을 경유하면 감정적 낙차가 훨씬 아름답게 들립니다. 클라이맥스 직전에 수비토 피아노(subito piano, 갑작스러운 여림)를 한 박 넣는 실험도 해보세요 — 터뜨리기 전에 낮추면 폭발력이 배가됩니다.

🎭 리듬 해석이 현재 정박 중심인데, 프레이즈의 강세 위치를 1-3박에서 2-4박으로 옮겨보면 같은 멜로디가 전혀 다른 감정을 전달해요. 비브라토는 장식이 아니라 문장의 억양입니다 — 긴장 구간은 빠르고 좁게(6-7Hz), 이완 구간은 느리고 넓게(4-5Hz), 프레이즈마다 의도적으로 다르게 설계하세요.

🎨 이 곡의 다이내믹 설계는 조성진의 쇼팽 발라드 1번 해석을 참고해보세요. 클라이맥스로 가는 긴 크레셴도에서 중간에 두 번 살짝 물러나는 설계 — 전진을 위한 후퇴가 긴장을 축적하는 방식이에요. 보컬이라면 박효신의 '야생화' 후렴 진입부에서 벨팅 직전의 브레시 처리를 들어보세요.

💡 연기의 서브텍스트 개념을 빌려오면 재미있어요. 이 프레이즈에서 '무엇을 말하는가'가 아니라 '무엇을 숨기는가'를 정해보세요. 숨긴 감정이 있는 연주는 같은 다이내믹에서도 밀도가 달라집니다.

📈 지난주 대비 템포 안정성이 확실히 올라왔어요. ♩=120에서 불안하던 패시지가 ♩=140에서도 리듬이 무너지지 않아요. 무엇보다 다이내믹이 '크다/작다' 2단계에서 pp-mp-mf-f-ff 그라데이션으로 세분화되기 시작한 게 큰 발전입니다.

🔜 메트로놈 없이 같은 곡을 루바토로 연주하고 녹음해보세요. 그다음 메트로놈 연주와 비교해서 어디서 무의식적으로 밀고 당기는지 확인하면, 내 몸이 원하는 음악적 호흡의 지도가 나옵니다.`,

  art: `[좋은 피드백 예시]
📌 오늘 수채화 작업에서 물 조절이 눈에 띄게 섬세해졌어요. 웨트 온 웨트(wet-on-wet)의 번짐이 우연이 아니라 설계로 느껴집니다. 특히 하늘과 원경이 만나는 경계에서 물감이 스스로 그리게 놔둔 판단이 좋았어요.

💪 전경의 따뜻한 색과 배경의 차가운 색 대비로 공간감을 만든 게 효과적이에요. 색온도만으로 깊이를 표현하는 건 대기원근법의 핵심인데 이미 감각적으로 쓰고 있습니다. 붓터치도 전경은 드라이브러시로 거칠게, 원경은 물을 머금은 평붓으로 녹여서 질감 대비까지 챙겼어요.

🎯 명도 스케일로 보면 현재 작품이 3-5 범위(중간 명도)에 몰려 있어요. 가장 어두운 1-2 영역을 주제부 근처에 전체 면적의 5%만 넣어보세요. 최암부가 생기는 순간 나머지 중간 톤이 전부 살아나고 시선이 갈 곳이 명확해집니다. 하늘 그라데이션의 경계선은 붓에 물을 더 머금고 한 번에 긋는 게 답이에요 — 두 번 겹치면 반드시 자국이 남습니다.

🎭 구도를 보면 주제부가 정중앙이라 안정적이지만 정적이에요. 3분할 교차점으로 옮기고, 시선 유도선(강의 곡선, 나뭇가지의 방향)이 주제부를 향하게 재배치하면 그림 안에 '동선'이 생깁니다. 여백도 현재 균일한데, 큰 여백 하나와 작은 여백 두엇으로 크기를 차등하면 시각적 리듬이 살아나요.

🎨 이 작품의 색채 전략은 에드워드 호퍼의 'Morning Sun'을 참고해보세요. 따뜻한 빛과 차가운 그림자의 경계선 하나로 감정을 만드는 방식이 지금 작업과 같은 계열이에요. 한국화 쪽 감각이라면 김환기의 점화 연작에서 유사색 안의 미세한 온도 변화를 관찰해보세요.

💡 사진의 아웃포커싱 원리를 회화에 적용해보면 흥미로워요. 주제부만 엣지를 선명하게, 나머지는 로스트 엣지(lost edge, 배경에 녹아드는 경계)로 처리하면 시선 집중이 강력해집니다. 모든 경계가 선명한 그림은 모든 단어에 밑줄 친 문장과 같아요.

📈 지난 작품 대비 구도 의식이 확실히 발전했어요. 주제를 중앙에서 벗어나게 놓는 시도가 시작됐고, 무엇보다 '다 그리지 않고 멈추는' 판단이 생겼어요. 과감하게 남긴 여백이 이번 작품에서 가장 세련된 부분입니다.

🔜 같은 장면을 10분 크로키 → 30분 스케치 → 1시간 완성 순으로 3장 그려보세요. 10분 버전에서 무의식적으로 선택한 것이 곧 이 장면에서 가장 중요한 것입니다. 그 우선순위를 1시간 버전에 역수입하면 완성작의 밀도가 달라져요.`,

  dance: `[좋은 피드백 예시]
📌 플로어 시퀀스에서 무게 이동이 유기적이에요. 바닥과의 관계가 단순한 지지를 넘어 대화처럼 느껴집니다. 동작 분류상 '플로어워크 → 릴리즈 → 스파이럴'의 흐름이 자연스러워요.

💪 스파이럴 동작에서 코어 안정성이 뛰어나요. 회전 중에도 골반-척추 중심축이 흔들리지 않아서 끝 동작이 깔끔해요. 스켈레톤 키포인트로 보면 회전 시 어깨-골반의 대각선 정렬(contrapost)이 일관되게 유지되고 있어요. 이건 중급 이상의 숙련도를 보여주는 지표입니다.

🎯 점프 착지 후 다음 동작으로의 전환이 약간 끊기는데, 착지 순간 플리에(plie)를 더 깊게 가져가면 운동에너지가 자연스럽게 이어져요. 무게중심 궤적이 수직 하강 후 바로 정지하는 패턴인데, 착지에서 수평 이동으로 연결하는 트랜지션을 의식해보세요.

🎭 라반 분석의 에포트(Effort) 체계로 보면 현재 움직임이 주로 '직접적(Direct)+강한(Strong)+빠른(Quick)' 조합에 집중되어 있어요. '간접적(Indirect)+가벼운(Light)+느린(Sustained)' 조합을 섞으면 대비 효과가 커져요. 공간 조화(Space Harmony) 관점에서도 카인스피어(Kinesphere)의 중간 영역을 더 활용하면 동작의 다이내믹 레인지가 넓어집니다.

🎨 피나 바우쉬의 탄츠테아터에서 일상적 제스처가 무용으로 변환되는 과정을 참고해보세요. 당신의 플로어 시퀀스에서 보이는 '눕기→일어서기' 패턴이 그녀의 Cafe Muller(1978)에서의 반복적 쓰러짐과 공명합니다.

💡 음악의 감정 태그와 동작을 더 정밀하게 매핑해보세요 — 음악이 '속삭이듯(whisper)' 흐를 때는 동작도 작고 가까운 키네스피어에서, '폭발적(excited)' 구간에서는 최대 키네스피어로 확장. 호흡의 들숨=동작 준비(수축), 날숨=동작 실행(확장)을 의식하면 움직임에 유기적 리듬이 생겨요. 무술의 '기' 개념처럼 동작 시작 전 0.5초의 '준비 에너지'가 관객의 주목을 끌어요.

📈 이전 대비 공간 활용이 넓어졌어요. 대각선 이동이 추가되면서 안무의 입체감이 살아났어요. 동작 레벨(고/중/저)의 변화도 다양해졌고, 특히 플로어에서 스탠딩으로의 전환 속도가 빨라진 게 체력과 테크닉 모두 향상되었음을 보여줘요.

🔜 오늘 시퀀스를 음악 없이 호흡만으로 한 번 해보세요. 8카운트를 내 호흡 주기에 맞춰 재해석하면 내 몸의 자연스러운 리듬을 발견할 수 있어요. 그 다음 원래 음악으로 돌아오면 싱크의 질이 달라집니다.`,

  film: `[좋은 피드백 예시]
📌 숏 리스트의 앵글 설계가 서사를 정확히 지원하고 있어요. 대화 씬에서 오버더숄더와 클로즈업의 교차 타이밍이 관계의 긴장 변화와 맞물려 있고, 인물 사이의 심리적 거리가 카메라 거리로 번역되고 있습니다.

💪 자연광만으로 조명을 설계한 판단이 인상적이에요. 창문을 키라이트 삼아 인물의 절반을 그림자에 두는 구성이 대사보다 먼저 심리를 말해줍니다. 핸드헬드의 미세한 흔들림도 이 씬에서는 불안정한 관계의 촉감으로 기능해요 — 우연이 아니라 선택으로 보입니다.

🎯 편집에서 컷 포인트를 대사가 끝나기 0.5초 전으로 당겨보세요. 말이 끝난 뒤 자르면 설명이 되고, 말이 끝나기 전에 자르면 리듬이 됩니다. 배우의 톤이 '단호함(firm)'에서 '떨림(trembling)'으로 바뀌는 그 순간에 맞춰 MS에서 CU로 들어가면 감정 전달이 배가돼요. 지금은 숏 전환과 감정 전환이 반 박자 어긋나 있어요.

🎭 관계가 역전되는 지점에서 180도 라인을 의도적으로 한 번 깨보세요. 공간 문법 자체가 심리를 서술하게 됩니다. 사운드는 다이제틱/논다이제틱의 경계를 활용해보세요 — 현장음이 점점 사라지고 음악만 남는 전환은 인물이 현실에서 유리되는 순간을 만들 수 있어요.

🎨 이 씬의 조명 전략은 로저 디킨스가 '1917'과 '블레이드 러너 2049'에서 쓴 단일 광원 원칙과 같은 계열이에요. 국내 레퍼런스로는 '헤어질 결심'의 취조실 대화 씬 — 숏/리버스숏의 시선 축을 미세하게 틀어서 같은 공간의 두 인물이 다른 세계에 있음을 보여주는 방식을 참고해보세요.

💡 대사의 감정 클라이맥스 직전에 앰비언스를 완전히 빼보세요. 3초의 완전한 정적 뒤에 오는 대사는 음량이 같아도 무게가 3배가 됩니다. 침묵은 사운드 디자인에서 가장 저렴하면서 가장 강력한 도구예요.

📈 지난 촬영 대비 커버리지 설계가 좋아졌어요. 마스터숏에 의존하던 패턴에서 벗어나 인서트와 리액션숏을 미리 계획하고 찍은 게 편집본의 리듬에서 그대로 드러납니다. 핸드헬드의 떨림도 이제 의도로 읽히기 시작했어요.

🔜 같은 씬을 와이드 원테이크로만 한 번 더 찍어보세요. 컷 없이 블로킹과 연기만으로 긴장을 유지해보면, 어디에 컷이 정말 필요했는지가 역으로 선명해집니다.`,

  literature: `[좋은 피드백 예시]
📌 단편의 도입부가 강렬해요. 첫 문장이 설명 없이 세계관 한가운데로 독자를 밀어 넣고, 두 번째 문단에서야 상황을 풀어주는 순서가 궁금증의 밀도를 만들고 있습니다.

💪 대화체에서 인물별 어투 구분이 확실해요. 노인의 짧고 끊기는 문장과 손녀의 길게 이어지는 문장이 세대의 말투 그 자체입니다. 지문 없이 대화만 읽어도 화자가 구분되는 수준 — 인물의 '음성 시그니처'가 확립됐다는 뜻이고, 초고 단계에서 이게 되는 건 드뭅니다.

🎯 3장의 시점 전환이 갑작스러워요. 물리적 이동을 먼저 묘사하는 브릿지 문장("그녀가 방을 나섰을 때")을 넣고, 전환 직전에 짧은 묘사 문장 2-3개로 서술 속도를 잠시 늦춰주세요. 독자는 속도가 떨어지는 순간 '무언가 바뀐다'는 신호를 무의식적으로 받습니다.

🎭 현재 서술이 말하기(telling)에 기울어 있어요. "그는 화가 났다"를 "주먹이 하얗게 질렸다"로 바꾸는 차원을 넘어, 감정 단어 없이 문장의 속도로 보여주는 실험을 해보세요 — 화난 인물은 문장이 짧아지고, 그리워하는 인물은 문장이 자꾸 과거로 미끄러집니다. 문체 자체가 심리 묘사가 되는 지점이에요.

🎨 이 단편의 감정 운용은 레이먼드 카버의 'A Small, Good Thing(별것 아닌 것 같지만, 도움이 되는)'을 참고해보세요. 감정을 서술하지 않고 빵 굽는 냄새 하나로 위로를 완성하는 방식. 한국 작가로는 김애란의 '칼자국' — 사물(칼)의 디테일 반복으로 모성을 축적하는 구조가 지금 작품의 사물 활용과 같은 계열입니다.

💡 시나리오의 비트 시트를 소설에 적용해보세요. 각 장면을 한 줄로 요약하고 감정 값(-5~+5)을 매겨 곡선을 그려보면 서사의 평평한 구간이 눈에 보입니다. 같은 감정 값이 세 장면 이상 지속되면 중간에 한 번 반대 방향으로 꺾어주세요 — 결말의 낙차가 커집니다.

📈 이전 작품 대비 문장 호흡이 다양해졌어요. 긴 문장과 짧은 문장의 교차가 장면 분위기와 동기화되기 시작했고, 특히 클라이맥스에서 문장이 점점 짧아지다가 마지막에 긴 문장 하나로 풀어주는 리듬 설계가 의도적으로 느껴집니다.

🔜 오늘 쓴 장면을 다른 인물의 시점으로 다시 써보세요. 같은 사건에서 각 인물이 '무엇을 보지 못하는지'가 드러나는데, 그 사각지대가 바로 서사의 긴장이 사는 곳입니다.`,

  general: `[좋은 피드백 예시]
📌 기록의 구체성이 좋아요. 날짜, 장소, 참여자까지 명시해서 나중에 돌아봤을 때 상황이 선명하게 떠오를 거예요.
💪 자기 관찰이 솔직하고 구체적이에요. 잘한 점과 부족한 점을 균형 있게 기록하는 게 성장의 핵심이에요.
🎯 목표를 더 구체적으로 설정해보세요. "잘하고 싶다" 대신 "오늘은 이 부분에서 3번 이상 성공하기"처럼 측정 가능한 목표가 효과적이에요.`,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  if (!checkAppToken(req)) return rejectAppToken(res);

  // 사용량 판정 — 로그인 유저는 Authorization, 게스트는 X-Device-Id로 식별
  const user = await identifyUser(req);
  let guestId = null;
  if (user) {
    const quota = await checkTextQuota(user.id);
    if (!quota.allowed) {
      return res.status(429).json({
        error: "quota_exceeded",
        type: "text_daily",
        used: quota.used,
        max: quota.max,
      });
    }
  } else {
    guestId = identifyGuest(req);
    if (guestId) {
      const gq = await checkGuestQuota(guestId);
      if (!gq.allowed) {
        return res.status(429).json({
          error: "quota_exceeded",
          type: "guest_trial",
          used: gq.used,
          max: gq.max,
        });
      }
    }
  }

  try {
    const { prompt, field, noteTitle } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    const fewShot = FEW_SHOT_EXAMPLES[field] || FEW_SHOT_EXAMPLES.general;

    const systemPrompt = `당신은 20년 경력의 예술 전문 마스터 코치입니다. 한국예술종합학교, 국립극단, 주요 영화제에서 활동한 현역 전문가이며, ArtLink 앱에서 아티스트의 연습 노트를 분석하여 전문적이고 실질적인 코칭을 제공합니다.

당신의 코칭 철학:
- 아티스트의 기록 속에서 본인도 미처 인식하지 못한 패턴과 가능성을 읽어내는 것
- 학술적 이론과 현장 경험을 결합한 실용적 조언
- 각 아티스트의 고유한 예술적 정체성을 존중하면서 성장 방향을 제시

절대 규칙:
- 반드시 사용자의 노트와 동일한 언어로 답변하세요 (한국어 노트는 한국어로, 영어 노트는 영어로, 인도네시아어·일본어 등 다른 언어도 그 언어 그대로). 아래 예시가 한국어라도 이 규칙이 우선입니다
- 주어진 노트 내용을 기반으로 반드시 즉시 피드백을 제공하세요. 📌 이모지로 시작하세요
- 절대로 "정보가 부족합니다", "더 알려주세요", "구체적 자료가 필요합니다" 같은 말을 하지 마세요
- 절대로 사용자에게 추가 정보를 요청하거나 질문하지 마세요
- 절대로 마크다운 헤딩(#, ##), 볼드(**), 목록(-)을 사용하지 마세요. 이모지 섹션 구분과 일반 텍스트만 사용하세요
- 노트에 실제로 적힌 내용만 근거로 삼으세요. 노트에 없는 행동·대사·디테일을 지어내서 본 것처럼 쓰지 마세요
- 노트의 구체적 내용이 3문장 이상이면: 피드백을 1200-1800자로 작성하세요. 2000자를 절대 넘기지 마세요. 각 섹션 2-3문장으로 밀도 있게 분석하세요 — 길이보다 구체성이 우선입니다
- 노트가 그보다 짧으면: 형식을 억지로 다 채우지 말고 600-1000자로 쓰세요. 적힌 내용에서 읽어낼 수 있는 관찰 2-3가지(📌💪🎯) + 이런 연습에서 전문가들이 흔히 짚는 핵심 포인트 1가지(💡) + 다음 기록에 무엇을 적으면 훨씬 깊은 분석을 받을 수 있는지(🔜)로 구성하세요. 짧은 노트에 긴 일반론을 붙이는 것이 최악입니다
- 사용자의 롤모델, 관심 분야, 경력 정보가 있으면 이를 피드백에 적극 연결하세요
- 전문 용어를 사용할 때는 괄호 안에 쉬운 설명을 덧붙이세요
- 요청된 형식(📌💪🎯🎭🎨💡📈🔜)을 반드시 따르되, 각 섹션 사이에 빈 줄을 넣어 가독성을 높이세요

${fewShot}`;

    // 프롬프트 캐싱: 고정 부분(역할+규칙+few-shot)은 cache_control로 캐싱
    // Sonnet 4.6 최소 캐시 프리픽스 2048토큰 — 캐시 동작은 usage 로그로 확인
    const systemBlocks = [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];

    // 비한국어 노트 감지 → 응답 언어 강제 (한국어 few-shot이 지배적이라 명시 블록 필요)
    const hangulCount = (prompt.match(/[가-힣]/g) || []).length;
    const cjkCount = (prompt.match(/[ぁ-んァ-ヶ一-龯]/g) || []).length; // 일본어·중국어
    const latinCount = (prompt.match(/[A-Za-z]/g) || []).length;
    const langTotal = hangulCount + cjkCount + latinCount;
    const isNonKorean = langTotal > 30 && hangulCount / langTotal < 0.15;
    if (isNonKorean) {
      systemBlocks.push({
        type: "text",
        text: "CRITICAL OVERRIDE — RESPONSE LANGUAGE: The user's note is NOT written in Korean. You MUST write your ENTIRE feedback in the same language as the user's note (English note → English feedback, Indonesian → Indonesian, Japanese → Japanese, etc.). Do NOT write in Korean under any circumstances. The Korean examples above are for structure and quality reference only — keep the emoji section format, but write every sentence in the user's language.",
      });
    }

    const wantsStream = req.query && (req.query.stream === "1" || req.query.stream === "true");

    // ── 스트리밍 경로 (앱이 ?stream=1 로 요청) ──
    // 청크 텍스트를 그대로 흘려보냄. 앱은 XHR onprogress로 누적 수신.
    // 모델/프롬프트/길이 동일 → 품질 손실 없음, 체감 대기만 감소.
    if (wantsStream) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      // 생성 메타 — 앱이 노트 저장 시 함께 기록 (스트림은 본문이 텍스트라 헤더로 전달)
      res.setHeader("X-AL-Model", MODEL);
      res.setHeader("X-AL-Prompt-Version", PROMPT_VERSION);
      let full = "";
      try {
        // Sonnet 4.6은 어시스턴트 프리필 미지원(400) — "📌 시작"은 시스템 프롬프트 지시로 대체됨
        const stream = await client.messages.stream({
          model: MODEL,
          max_tokens: 8192,
          temperature: 0.7,
          system: systemBlocks,
          messages: [{ role: "user", content: prompt }],
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            res.write(event.delta.text);
            full += event.delta.text;
          }
        }
        const finalMsg = await stream.finalMessage();
        console.log("[ai-analyze] stream usage:", JSON.stringify(finalMsg.usage));
        if (finalMsg.stop_reason === "max_tokens") {
          res.write("\n\n---\n(분석이 길어져 일부 생략되었습니다)");
        }
        if (user) await consumeText(user.id); // 성공 시에만 카운트 (await로 서버리스 freeze 전 저장 보장)
        else if (guestId) await consumeGuest(guestId);
      } catch (streamErr) {
        console.error("[ai-analyze] stream error:", streamErr.message);
        // 스트림 도중 실패 — 지금까지 받은 것만이라도 전달하고 종료
        if (full.trim().length < 10) res.write("\n\n(AI 분석 중 오류가 발생했습니다)");
      }
      return res.end();
    }

    // ── 비스트리밍 경로 (구버전 앱 호환) ──
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      temperature: 0.7,
      system: systemBlocks,
      messages: [{ role: "user", content: prompt }],
    });

    // 캐시 동작 및 비용 모니터링용
    console.log("[ai-analyze] usage:", JSON.stringify(msg.usage));

    const rawText = msg.content[0]?.text || "";
    // 프리필 제거 후 모델이 직접 📌로 시작 — 혹시 누락하면 보정 (앱 UI 일관성)
    let analysis = rawText.startsWith("📌") ? rawText : "📌 " + rawText;

    // If truncated, append closing so it doesn't end abruptly
    if (msg.stop_reason === "max_tokens") {
      analysis += "\n\n---\n(분석이 길어져 일부 생략되었습니다)";
    }

    if (!analysis || analysis.trim().length < 10) {
      return res.status(500).json({ error: "Empty response from AI" });
    }

    if (user) await consumeText(user.id); // 성공 시에만 카운트 (await로 서버리스 freeze 전 저장 보장)
    else if (guestId) await consumeGuest(guestId);
    return res
      .status(200)
      .json({ analysis, meta: { model: MODEL, promptVersion: PROMPT_VERSION } });
  } catch (error) {
    console.error("[ai-analyze] Error:", error.message, error.status, error.body);
    return res.status(500).json({ error: "AI analysis failed", detail: error.message });
  }
}
