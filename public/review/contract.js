(function (root, factory) {
  if (typeof module === 'object') module.exports = factory();else root.ArtlinkReview = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const fields = ['acting', 'music', 'art', 'dance', 'literature', 'film'];
  const labels = {
    acting: ['연기', 'Acting'],
    music: ['음악', 'Music'],
    art: ['미술', 'Art'],
    dance: ['무용', 'Dance'],
    literature: ['문학', 'Literature'],
    film: ['영화', 'Film']
  };
  const types = {
    'image/jpeg': 'image',
    'image/png': 'image',
    'image/webp': 'image',
    'audio/mpeg': 'audio',
    'audio/mp4': 'audio',
    'audio/x-m4a': 'audio',
    'audio/wav': 'audio',
    'audio/x-wav': 'audio',
    'video/mp4': 'video',
    'video/quicktime': 'video',
    'video/webm': 'video'
  };
  // Original prompts: an editable starting point, never an automatic assessment.
  const reviewPrompts = {
    acting: [{
      label: ['상대와의 관계', 'Relationship'],
      question: ['상대의 말에 반응하는 순간이 자연스러운가요? 어색한 지점을 짚어주세요.', 'Do my reactions to the other character feel natural? Please point to a specific moment.']
    }, {
      label: ['행동과 감정', 'Action and emotion'],
      question: ['인물이 원하는 것이 행동으로 보이나요? 감정이 갑자기 바뀌는 지점이 있는지 궁금해요.', 'Is the character’s intention visible in their actions? Where does an emotional shift feel abrupt?']
    }, {
      label: ['대사 전달', 'Delivery'],
      question: ['말의 속도와 멈춤 때문에 의미가 흐려지는 대사를 알려주세요.', 'Which lines lose their meaning because of pace or pauses?']
    }],
    music: [{
      label: ['연주·보컬', 'Performance'],
      question: ['프레이징과 강약이 곡의 분위기를 전달하나요? 한 구간을 골라 의견을 주세요.', 'Do the phrasing and dynamics convey the mood? Please choose one passage to discuss.']
    }, {
      label: ['곡의 전개', 'Arrangement'],
      question: ['도입에서 다음 부분으로 넘어갈 때 흐름이 자연스러운가요? 늘어지는 구간이 궁금해요.', 'Does the transition from the opening flow naturally? Which section feels too long?']
    }, {
      label: ['소리의 균형', 'Sound balance'],
      question: ['주요 멜로디나 목소리를 가리는 소리가 있나요? 시간과 함께 알려주세요.', 'Does anything obscure the main melody or voice? Please include a timestamp.']
    }],
    art: [{
      label: ['구도와 시선', 'Composition'],
      question: ['처음 시선이 가는 곳과 이후의 흐름이 궁금해요. 그림 위에 위치를 짚어주세요.', 'Where does your eye go first, and then next? Please mark a point on the image.']
    }, {
      label: ['색과 명암', 'Color and value'],
      question: ['색이나 명암 때문에 중심이 약해지는 부분이 있나요? 구체적인 위치가 궁금해요.', 'Where do color or value choices weaken the focal point? Please mark the area.']
    }, {
      label: ['작품의 의도', 'Intent'],
      question: ['이 작품에서 어떤 분위기나 이야기를 읽었나요? 그렇게 느낀 요소를 알려주세요.', 'What mood or story do you read in this work? Which elements give you that impression?']
    }],
    dance: [{
      label: ['움직임의 연결', 'Transitions'],
      question: ['동작 사이의 연결이 끊겨 보이는 구간이 있나요? 시간을 짚어주세요.', 'Where does the transition between movements feel disconnected? Please include a timestamp.']
    }, {
      label: ['공간과 동선', 'Space and pathways'],
      question: ['공간을 사용하는 방식과 동선이 의도를 전달하나요? 눈에 띄는 구간이 궁금해요.', 'Do the pathways and use of space communicate the intention? Which passage stands out?']
    }, {
      label: ['리듬과 강약', 'Rhythm and dynamics'],
      question: ['리듬과 힘의 변화가 분명하게 느껴지나요? 대비가 필요한 구간을 알려주세요.', 'Are changes in rhythm and energy clear? Where would more contrast help?']
    }],
    literature: [{
      label: ['인물의 선택', 'Character choices'],
      question: ['인물의 선택을 납득하기 어려운 문단이 있나요? 부족한 단서를 알려주세요.', 'Which paragraph makes a character’s choice hard to believe? What context is missing?']
    }, {
      label: ['문장과 목소리', 'Voice and sentences'],
      question: ['문장의 리듬이나 화자의 목소리가 흔들리는 부분을 짚어주세요.', 'Where does the sentence rhythm or narrative voice feel inconsistent?']
    }, {
      label: ['전개와 몰입', 'Pacing'],
      question: ['읽다가 궁금함이 줄거나 흐름이 끊기는 문단이 어디인가요?', 'At which paragraph does your curiosity fade or the flow break?']
    }],
    film: [{
      label: ['편집과 호흡', 'Editing and pace'],
      question: ['컷의 길이나 연결 때문에 흐름이 끊기는 지점을 알려주세요.', 'Where do shot length or cuts interrupt the flow?']
    }, {
      label: ['장면의 전달', 'Scene clarity'],
      question: ['인물의 목표나 공간 관계가 이해되지 않는 순간이 있나요? 시간을 짚어주세요.', 'When is the character’s goal or spatial relationship unclear? Please include a timestamp.']
    }, {
      label: ['소리와 이미지', 'Sound and image'],
      question: ['소리가 이미지의 감정이나 정보를 돕는지, 방해하는 구간은 없는지 궁금해요.', 'Does the sound support the emotion and information in the images? Where does it distract?']
    }]
  };
  function reviewBrief(reviewRequest, changeNote) {
    const clean = (value, max) => {
      if (value === undefined || value === null) return '';
      if (typeof value !== 'string' || value.length > max) throw Error('INVALID_BRIEF');
      return value.trim();
    };
    return {
      reviewRequest: clean(reviewRequest, 400),
      changeNote: clean(changeNote, 600)
    };
  }
  const maxBytes = 25 * 1024 * 1024;
  const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  const token = v => typeof v === 'string' && /^[0-9a-f]{48}$/.test(v);
  function anchor(value, kind, body = '') {
    if (!value || typeof value !== 'object') throw Error('INVALID_ANCHOR');
    if (value.kind === 'general') return {
      kind: 'general'
    };
    if (['audio', 'video'].includes(kind) && value.kind === 'time' && Number.isFinite(value.start) && Number.isFinite(value.end) && value.start >= 0 && value.end >= value.start && value.end <= 7200) return {
      kind: 'time',
      start: Math.round(value.start * 1000) / 1000,
      end: Math.round(value.end * 1000) / 1000
    };
    if (kind === 'image' && value.kind === 'point' && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1) return {
      kind: 'point',
      x: value.x,
      y: value.y
    };
    if (kind === 'text' && value.kind === 'paragraph' && Number.isInteger(value.index) && value.index >= 0 && value.index < body.split(/\n\s*\n/).length) return {
      kind: 'paragraph',
      index: value.index
    };
    throw Error('INVALID_ANCHOR');
  }
  function media(mime, size) {
    if (!types[mime] || !Number.isInteger(size) || size <= 0 || size > maxBytes) throw Error('INVALID_MEDIA');
    return {
      kind: types[mime],
      mime,
      bytes: size
    };
  }
  function invitation(base, id, key, lang = 'ko') {
    if (!uuid(id) || !token(key)) throw Error('INVALID_LINK');
    return `${base}/review/?lang=${lang === 'en' ? 'en' : 'ko'}#room=${id}&key=${key}`;
  }
  return {
    fields,
    labels,
    types,
    maxBytes,
    uuid,
    token,
    anchor,
    media,
    invitation,
    reviewPrompts,
    reviewBrief
  };
});
