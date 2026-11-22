/**
 * GraceInterpret — メインアプリケーションコントローラー
 *
 * 【2枠・連続文章ストリーム方式】
 * - 「🇯🇵 音声認識 書き起こし」の1つの枠と、「🇺🇸 同時通訳（English）」の1つの枠を設け、
 *   細切れのカードに分けず、それぞれの枠の中に一連のひと続きの文章としてリアルタイムに追記表示します。
 */

import {
  GLOSSARY_CATEGORIES,
  DEFAULT_PROTESTANT_GLOSSARY,
  SAMPLE_SERMON_SEGMENTS,
  normalizeChurchSpeechText,
} from './glossary-presets.js';
import { ChurchInterpreterService, SUPPORTED_LANGUAGES } from './gemini-service.js';
import {
  HIROSHIMA_BUILDINGS,
  buildHiroshimaRoomId,
  findBuildingAndRoom,
} from './buildings-config.js';

const STORAGE_KEYS = {
  GLOSSARY: 'grace_interpret_glossary_v1',
  GLOSSARY_MIGRATED: 'grace_interpret_glossary_migrated_v2',
  SETTINGS: 'grace_interpret_settings_v2',
  HISTORY: 'grace_interpret_history_v1',
  FEEDBACK_RULES: 'grace_interpret_feedback_rules_v1',
  CORRECTIONS: 'grace_interpret_corrections_v1',
};

class GraceInterpretApp {
  constructor() {
    this.interpreter = new ChurchInterpreterService();
    this.glossary = this.loadGlossary();
    this.settings = this.loadSettings();
    this.feedbackRules = this.loadFeedbackRules();
    this.correctionExamples = this.loadCorrectionExamples();

    this.selectedCategory = 'all';
    this.searchQuery = '';
    this.history = this.loadHistory(); // 時系列の文セグメント配列（1つの連続枠に連結して描画）
    this.autoScrollEnabled = true;

    // 複数言語通訳 & P2Pライブ配信の状態
    this.currentViewTargetLang = 'all'; // 'all' (並列) または 特定の言語コード
    this.hostPeer = null;
    this.hostInstanceId = 'host-' + Math.random().toString(36).slice(2, 9);
    this.connectedClients = new Set();
    this.viewerAudioSubscribers = new Map(); // clientId -> { lang, updatedAt }

    // 音声認識・連続文章連結の状態
    this.isListening = false;
    this.isPaused = false;
    this.recognition = null;
    this.committedOffsets = new Map();
    this.interimPauseTimer = null;
    this.lastSpeechTimestamp = 0;

    this.initElements();
    this.setupDialogFallbacks();
    this.applySettingsToService();
    this.populateBuildingAndRoomSelects();
    this.populateSampleDropdown();
    this.bindEvents();
    this.renderGlossary();
    this.restoreSavedHistoryToStream();
    this.updateHeaderStatus();
    this.initHostPeer();
  }

  initElements() {
    // Header & View controls
    this.brandSubtitle = document.getElementById('brandSubtitle');
    this.churchNameBadge = document.getElementById('churchNameBadge');
    this.buildingSelect = document.getElementById('buildingSelect');
    this.roomSelect = document.getElementById('roomSelect');
    this.roomConflictBadge = document.getElementById('roomConflictBadge');
    this.shareBuildingRoomLabel = document.getElementById('shareBuildingRoomLabel');
    this.printQrPosterBtn = document.getElementById('printQrPosterBtn');
    this.sourceLangSelect = document.getElementById('sourceLangSelect');
    this.targetLangChips = document.getElementById('targetLangChips');
    this.targetCountBadge = document.getElementById('targetCountBadge');
    this.openShareModalBtn = document.getElementById('openShareModalBtn');
    this.shareLiveDot = document.getElementById('shareLiveDot');
    this.sceneModeSelect = document.getElementById('sceneModeSelect');
    this.viewModeSelect = document.getElementById('viewModeSelect');
    this.fontScaleRange = document.getElementById('fontScaleRange');
    this.projectorBtn = document.getElementById('projectorBtn');
    this.exitProjectorBtn = document.getElementById('exitProjectorBtn');
    this.openGlossaryModalBtn = document.getElementById('openGlossaryModalBtn');
    this.activeGlossaryCount = document.getElementById('activeGlossaryCount');
    this.openSettingsBtn = document.getElementById('openSettingsBtn');
    this.settingsDropdownWrapper = document.getElementById('settingsDropdownWrapper');
    this.openSettingsMenuBtn = document.getElementById('openSettingsMenuBtn');
    this.settingsDropdownMenu = document.getElementById('settingsDropdownMenu');
    this.menuExportTxtBtn = document.getElementById('menuExportTxtBtn');
    this.menuFeedbackBtn = document.getElementById('menuFeedbackBtn');
    this.menuGlossaryBtn = document.getElementById('menuGlossaryBtn');
    this.menuGlossaryCount = document.getElementById('menuGlossaryCount');
    this.menuApiSettingsBtn = document.getElementById('menuApiSettingsBtn');
    this.apiStatusDot = document.getElementById('apiStatusDot');

    // Audio & Live stage controls
    this.micToggleBtn = document.getElementById('micToggleBtn');
    this.micBtnText = document.getElementById('micBtnText');
    this.pauseMicBtn = document.getElementById('pauseMicBtn');
    this.liveStatusBadge = document.getElementById('liveStatusBadge');
    this.liveStatusText = document.getElementById('liveStatusText');
    this.sampleSegmentSelect = document.getElementById('sampleSegmentSelect');
    this.runSampleBtn = document.getElementById('runSampleBtn');
    this.ttsToggleCheckbox = document.getElementById('ttsToggleCheckbox');
    this.ttsToggleLabelText = document.getElementById('ttsToggleLabelText');
    this.highlightTermsCheckbox = document.getElementById('highlightTermsCheckbox');
    this.copyAllLogBtn = document.getElementById('copyAllLogBtn');
    this.exportLogBtn = document.getElementById('exportLogBtn');
    this.openFeedbackModalBtn = document.getElementById('openFeedbackModalBtn');
    this.activeFeedbackCount = document.getElementById('activeFeedbackCount');
    this.clearLogBtn = document.getElementById('clearLogBtn');
    this.toggleCompactModeBtn = document.getElementById('toggleCompactModeBtn');
    this.compactBtnIcon = document.getElementById('compactBtnIcon');
    this.compactBtnText = document.getElementById('compactBtnText');

    // Post-session banner
    this.postSessionActionBanner = document.getElementById('postSessionActionBanner');
    this.bannerExportTxtBtn = document.getElementById('bannerExportTxtBtn');
    this.bannerOpenFeedbackBtn = document.getElementById('bannerOpenFeedbackBtn');
    this.dismissBannerBtn = document.getElementById('dismissBannerBtn');

    this.liveStage = document.getElementById('liveStage');
    this.twoBoxesWorkspace = document.getElementById('twoBoxesWorkspace');
    this.boxSplitter = document.getElementById('boxSplitter');
    this.streamLayoutTabs = document.getElementById('streamLayoutTabs');
    this.insertParagraphBtn = document.getElementById('insertParagraphBtn');
    this.stageModelInfo = document.getElementById('stageModelInfo');
    this.scrollToLatestBtn = document.getElementById('scrollToLatestBtn');

    // 2 Single Continuous Boxes (1 for Source Transcription, 1 for Target Interpretation)
    this.sourceBoxFlag = document.getElementById('sourceBoxFlag');
    this.sourceBoxTitle = document.getElementById('sourceBoxTitle');
    this.jaScrollContainer = document.getElementById('jaScrollContainer');
    this.jaPlaceholderText = document.getElementById('jaPlaceholderText');
    this.jaCommittedContainer = document.getElementById('jaCommittedContainer');
    this.jaLiveInterimSpan = document.getElementById('jaLiveInterimSpan');
    this.copyJaOnlyBtn = document.getElementById('copyJaOnlyBtn');

    this.targetBoxFlag = document.getElementById('targetBoxFlag');
    this.targetBoxTitle = document.getElementById('targetBoxTitle');
    this.targetLangTabs = document.getElementById('targetLangTabs');
    this.multiTargetStreams = document.getElementById('multiTargetStreams');
    this.enSingleBox = document.getElementById('enSingleBox');
    this.enScrollContainer = document.getElementById('enScrollContainer');
    this.enPlaceholderText = document.getElementById('enPlaceholderText');
    this.enCommittedContainer = document.getElementById('enCommittedContainer');
    this.latestMatchedTermsStrip = document.getElementById('latestMatchedTermsStrip');
    this.copyEnOnlyBtn = document.getElementById('copyEnOnlyBtn');

    // Share Live Dialog
    this.shareDialog = document.getElementById('shareDialog');
    this.shareRoomIdLabel = document.getElementById('shareRoomIdLabel');
    this.connectedPeersCountLabel = document.getElementById('connectedPeersCountLabel');
    this.regenerateRoomBtn = document.getElementById('regenerateRoomBtn');
    this.editRoomBtn = document.getElementById('editRoomBtn');
    this.shareCardsContainer = document.getElementById('shareCardsContainer');
    this.closeShareDialogBtn = document.getElementById('closeShareDialogBtn');
    this.closeShareFooterBtn = document.getElementById('closeShareFooterBtn');

    // Manual input
    this.manualInputForm = document.getElementById('manualInputForm');
    this.manualJaInput = document.getElementById('manualJaInput');
    this.clearManualInputBtn = document.getElementById('clearManualInputBtn');
    this.historyCountLabel = document.getElementById('historyCountLabel');

    // Glossary dialog
    this.glossaryDialog = document.getElementById('glossaryDialog');
    this.closeGlossaryDialogBtn = document.getElementById('closeGlossaryDialogBtn');
    this.addTermQuickBtn = document.getElementById('addTermQuickBtn');
    this.glossarySearchInput = document.getElementById('glossarySearchInput');
    this.categoryFilterChips = document.getElementById('categoryFilterChips');
    this.glossaryListContainer = document.getElementById('glossaryListContainer');
    this.exportGlossaryCsvBtn = document.getElementById('exportGlossaryCsvBtn');
    this.importGlossaryFileInput = document.getElementById('importGlossaryFileInput');
    this.resetGlossaryBtn = document.getElementById('resetGlossaryBtn');
    this.backupGlossaryGithubBtn = document.getElementById('backupGlossaryGithubBtn');
    this.restoreGlossaryGithubBtn = document.getElementById('restoreGlossaryGithubBtn');

    // Term Dialog
    this.termDialog = document.getElementById('termDialog');
    this.termForm = document.getElementById('termForm');
    this.termDialogTitle = document.getElementById('termDialogTitle');
    this.termIdInput = document.getElementById('termIdInput');
    this.termJaInput = document.getElementById('termJaInput');
    this.termEnInput = document.getElementById('termEnInput');
    this.termCategorySelect = document.getElementById('termCategorySelect');
    this.termReadingInput = document.getElementById('termReadingInput');
    this.termVariantsInput = document.getElementById('termVariantsInput');
    this.termNoteInput = document.getElementById('termNoteInput');
    this.closeTermDialogBtn = document.getElementById('closeTermDialogBtn');
    this.cancelTermDialogBtn = document.getElementById('cancelTermDialogBtn');

    // Settings Dialog
    this.settingsDialog = document.getElementById('settingsDialog');
    this.settingsForm = document.getElementById('settingsForm');
    this.apiKeyInput = document.getElementById('apiKeyInput');
    this.toggleApiKeyVisibilityBtn = document.getElementById('toggleApiKeyVisibilityBtn');
    this.testApiConnectionBtn = document.getElementById('testApiConnectionBtn');
    this.apiTestResultBox = document.getElementById('apiTestResultBox');
    this.geminiModelSelect = document.getElementById('geminiModelSelect');
    this.ttsModelSelect = document.getElementById('ttsModelSelect');
    this.ttsVoiceSelect = document.getElementById('ttsVoiceSelect');
    this.audioInputModeSelect = document.getElementById('audioInputModeSelect');
    this.churchNameInput = document.getElementById('churchNameInput');
    this.autoCommitLengthInput = document.getElementById('autoCommitLengthInput');
    this.githubRepoInput = document.getElementById('githubRepoInput');
    this.githubTokenInput = document.getElementById('githubTokenInput');
    this.toggleGithubTokenVisibilityBtn = document.getElementById('toggleGithubTokenVisibilityBtn');
    this.closeSettingsDialogBtn = document.getElementById('closeSettingsDialogBtn');
    this.cancelSettingsBtn = document.getElementById('cancelSettingsBtn');

    // Feedback & Correction Learning Dialog
    this.feedbackDialog = document.getElementById('feedbackDialog');
    this.closeFeedbackDialogBtn = document.getElementById('closeFeedbackDialogBtn');
    this.closeFeedbackFooterBtn = document.getElementById('closeFeedbackFooterBtn');
    this.modalExportTxtBtn = document.getElementById('modalExportTxtBtn');
    this.importEditedTxtInput = document.getElementById('importEditedTxtInput');
    this.feedbackStatusMessage = document.getElementById('feedbackStatusMessage');
    this.sessionFeedbackTextarea = document.getElementById('sessionFeedbackTextarea');
    this.clearFeedbackInputBtn = document.getElementById('clearFeedbackInputBtn');
    this.applyFeedbackTextBtn = document.getElementById('applyFeedbackTextBtn');
    this.editableSegmentsContainer = document.getElementById('editableSegmentsContainer');
    this.applyEditedSegmentsBtn = document.getElementById('applyEditedSegmentsBtn');
    this.learnedRulesListContainer = document.getElementById('learnedRulesListContainer');
    this.clearAllFeedbackMemoryBtn = document.getElementById('clearAllFeedbackMemoryBtn');

    // Sermon Manuscript Glossary Extraction Dialog
    this.headerSermonExtractBtn = document.getElementById('headerSermonExtractBtn');
    this.openSermonExtractBtn = document.getElementById('openSermonExtractBtn');
    this.sermonExtractDialog = document.getElementById('sermonExtractDialog');
    this.closeSermonExtractDialogBtn = document.getElementById('closeSermonExtractDialogBtn');
    this.closeSermonExtractFooterBtn = document.getElementById('closeSermonExtractFooterBtn');
    this.sermonJaManuscriptInput = document.getElementById('sermonJaManuscriptInput');
    this.sermonEnManuscriptInput = document.getElementById('sermonEnManuscriptInput');
    this.fillSampleSermonPairBtn = document.getElementById('fillSampleSermonPairBtn');
    this.clearSermonExtractInputsBtn = document.getElementById('clearSermonExtractInputsBtn');
    this.runSermonExtractBtn = document.getElementById('runSermonExtractBtn');
    this.sermonExtractStatusMsg = document.getElementById('sermonExtractStatusMsg');
    this.sermonCandidatesSection = document.getElementById('sermonCandidatesSection');
    this.sermonCandidatesListContainer = document.getElementById('sermonCandidatesListContainer');
    this.registerSelectedCandidatesBtn = document.getElementById('registerSelectedCandidatesBtn');
    this.currentSermonCandidates = [];
  }

  setupDialogFallbacks() {
    const dialogs = document.querySelectorAll('dialog[closedby="any"]');

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      for (const dialog of dialogs) {
        dialog.addEventListener('click', (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent =
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width;
          if (isDialogContent) return;
          dialog.close();
        });
      }
    }

    for (const dialog of dialogs) {
      dialog.addEventListener('close', () => {
        dialog.returnValue = '';
      });
    }
  }

  loadGlossary() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.GLOSSARY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // 初回1回のみ、説教原稿プリセット(f-1〜f-39)が未反映の場合だけマージして保存し、
          // 以降はユーザーが削除・修正した内容を100%そのまま保持する（リロード時に復活させない）
          const migrated = localStorage.getItem(STORAGE_KEYS.GLOSSARY_MIGRATED);
          if (!migrated) {
            const existingIds = new Set(parsed.map((item) => item.id));
            const existingJa = new Set(parsed.map((item) => item.ja));
            for (const presetItem of DEFAULT_PROTESTANT_GLOSSARY) {
              if (
                presetItem.id.startsWith('f-') &&
                !existingIds.has(presetItem.id) &&
                !existingJa.has(presetItem.ja)
              ) {
                parsed.unshift(structuredClone(presetItem));
              }
            }
            localStorage.setItem(STORAGE_KEYS.GLOSSARY_MIGRATED, 'true');
            localStorage.setItem(STORAGE_KEYS.GLOSSARY, JSON.stringify(parsed));
          }
          return parsed;
        }
      }
    } catch {}
    const initial = structuredClone(DEFAULT_PROTESTANT_GLOSSARY);
    try {
      localStorage.setItem(STORAGE_KEYS.GLOSSARY_MIGRATED, 'true');
      localStorage.setItem(STORAGE_KEYS.GLOSSARY, JSON.stringify(initial));
    } catch {}
    return initial;
  }

  saveGlossary() {
    try {
      localStorage.setItem(STORAGE_KEYS.GLOSSARY, JSON.stringify(this.glossary));
    } catch {}
    this.updateHeaderStatus();
  }

  loadSettings() {
    const defaults = {
      apiKey: '',
      model: 'gemini-3.5-flash-lite',
      audioInputMode: 'webspeech-gemini',
      sceneMode: 'sermon',
      sourceLang: 'ja',
      targetLang: 'en',
      targetLangs: ['en'],
      buildingId: 'hakushima',
      roomSlotId: 'chapel',
      roomId: buildHiroshimaRoomId('hakushima', 'chapel'),
      churchName: '',
      autoCommitLength: 42,
      fontScale: 1.15,
      boxSplitRatio: 50,
      githubRepo: 'kmats1014/lds-interpret',
      githubToken: '',
      ttsModel: 'gemini-3.8-flash-lite-tts',
      ttsVoice: 'Kore',
    };
    try {
      const legacy = localStorage.getItem('grace_interpret_settings_v1');
      const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        const merged = { ...defaults, ...parsed };
        if (!Array.isArray(merged.targetLangs) || merged.targetLangs.length === 0) {
          merged.targetLangs = merged.targetLang ? [merged.targetLang] : ['en'];
        }
        merged.targetLangs = merged.targetLangs.slice(0, 3);
        if (!merged.buildingId) merged.buildingId = 'hakushima';
        if (!merged.roomSlotId) merged.roomSlotId = 'chapel';
        if (!merged.roomId || /^lds-[a-z0-9]+$/i.test(merged.roomId)) {
          merged.roomId = buildHiroshimaRoomId(merged.buildingId, merged.roomSlotId);
        }
        return merged;
      } else if (legacy) {
        const parsedLegacy = JSON.parse(legacy);
        return {
          ...defaults,
          apiKey: parsedLegacy.apiKey || '',
          churchName: parsedLegacy.churchName || '',
          sceneMode: parsedLegacy.sceneMode || 'sermon',
          roomId: 'lds-' + Math.random().toString(36).slice(2, 8),
        };
      }
    } catch {}
    defaults.roomId = buildHiroshimaRoomId('hakushima', 'chapel');
    return defaults;
  }

  saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(this.settings));
    } catch {}
    this.applySettingsToService();
    this.updateHeaderStatus();
  }

  loadHistory() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {}
    return [];
  }

  saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.history));
    } catch {}
  }

  loadFeedbackRules() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.FEEDBACK_RULES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  }

  saveFeedbackRules() {
    try {
      localStorage.setItem(STORAGE_KEYS.FEEDBACK_RULES, JSON.stringify(this.feedbackRules));
    } catch {}
    this.applySettingsToService();
    this.updateHeaderStatus();
  }

  loadCorrectionExamples() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CORRECTIONS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  }

  saveCorrectionExamples() {
    try {
      localStorage.setItem(STORAGE_KEYS.CORRECTIONS, JSON.stringify(this.correctionExamples));
    } catch {}
    this.applySettingsToService();
    this.updateHeaderStatus();
  }

  applySettingsToService() {
    if (!SUPPORTED_LANGUAGES[this.settings.sourceLang]) {
      this.settings.sourceLang = 'ja';
    }

    // 通訳先言語リスト（最大3つ、話す言語と被らないように調整）
    let validTargets = (this.settings.targetLangs || [])
      .filter((l) => SUPPORTED_LANGUAGES[l] && l !== this.settings.sourceLang)
      .slice(0, 3);

    if (validTargets.length === 0) {
      validTargets = [this.settings.sourceLang === 'en' ? 'ja' : 'en'];
    }
    this.settings.targetLangs = validTargets;
    this.settings.targetLang = validTargets[0]; // 第1言語

    this.interpreter.configure({
      apiKey: this.settings.apiKey,
      model: this.settings.model,
      sceneMode: this.settings.sceneMode,
      sourceLang: this.settings.sourceLang,
      targetLang: this.settings.targetLang,
      churchName: this.settings.churchName,
      feedbackRules: this.feedbackRules,
      correctionExamples: this.correctionExamples,
    });

    if (this.sourceLangSelect) {
      this.sourceLangSelect.value = this.settings.sourceLang;
    }
    this.sceneModeSelect.value = this.settings.sceneMode;
    this.fontScaleRange.value = String(this.settings.fontScale || 1.15);
    document.documentElement.style.setProperty('--subtitle-scale', String(this.settings.fontScale || 1.15));

    this.updateLanguagePairUI();
  }

  updateLanguagePairUI() {
    const srcInfo = this.interpreter.getSourceLangInfo();
    const targetCodes = this.settings.targetLangs || ['en'];
    const targetInfos = targetCodes.map((code) => SUPPORTED_LANGUAGES[code] || SUPPORTED_LANGUAGES.en);

    // ヘッダー字幕テキストの更新
    if (this.brandSubtitle) {
      const tgtNames = targetInfos.map((t) => `${t.flag} ${t.nameJa}`).join(' ＋ ');
      this.brandSubtitle.textContent = `${srcInfo.flag} ${srcInfo.nameJa}音声 ➔ ${tgtNames} リアルタイム同時通訳・教会用語集連動`;
    }

    // 音声認識書き起こし枠（左枠）のラベル更新
    if (this.sourceBoxFlag) {
      this.sourceBoxFlag.textContent = srcInfo.flag;
    }
    if (this.sourceBoxTitle) {
      this.sourceBoxTitle.textContent = srcInfo.sourceBoxTitle;
    }
    if (this.copyJaOnlyBtn) {
      this.copyJaOnlyBtn.textContent = srcInfo.copySourceLabel;
    }
    if (this.jaPlaceholderText) {
      this.jaPlaceholderText.textContent = srcInfo.sourcePlaceholder;
    }
    if (this.manualJaInput) {
      this.manualJaInput.placeholder = srcInfo.manualPlaceholder;
    }

    // 通訳先チップ群の描画
    this.renderTargetLangChips();

    // 通訳枠（右枠）のヘッダータブ・ストリームパネルの更新
    this.renderTargetStreamUI();
  }

  renderTargetLangChips() {
    if (!this.targetLangChips) return;
    this.targetLangChips.innerHTML = '';
    const currentTargets = this.settings.targetLangs || ['en'];
    const currentSource = this.settings.sourceLang || 'ja';

    if (this.targetCountBadge) {
      this.targetCountBadge.textContent = `${currentTargets.length}/3`;
      this.targetCountBadge.style.background = currentTargets.length === 3 ? '#dbeafe' : 'var(--gold-soft)';
      this.targetCountBadge.style.color = currentTargets.length === 3 ? '#1d4ed8' : 'var(--primary-blue)';
    }

    const availableCodes = Object.keys(SUPPORTED_LANGUAGES);

    for (const code of availableCodes) {
      const info = SUPPORTED_LANGUAGES[code];
      const isSource = code === currentSource;
      const isSelected = currentTargets.includes(code);

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `target-chip ${isSelected ? 'active' : ''}`.trim();
      chip.disabled = isSource;
      chip.title = isSource
        ? '現在「話す言語」に指定されています'
        : isSelected
        ? `クリックして${info.nameJa}通訳を解除`
        : `クリックして${info.nameJa}を通訳先に追加（最大3言語まで選択可能）`;

      chip.innerHTML = `${isSelected ? '✓ ' : ''}${info.flag} ${info.nameJa}`;

      chip.addEventListener('click', () => {
        if (isSource) return;
        if (isSelected) {
          if (currentTargets.length <= 1) {
            alert('通訳先言語は最低1つ選択されている必要があります。');
            return;
          }
          this.settings.targetLangs = currentTargets.filter((c) => c !== code);
        } else {
          if (currentTargets.length >= 3) {
            alert('同時に通訳できる言語は最大3つまでです。別の言語を解除してから選択してください。');
            return;
          }
          this.settings.targetLangs = [...currentTargets, code];
        }
        this.saveSettings();
        this.rebuildContinuousBoxesFromHistory();
      });

      this.targetLangChips.appendChild(chip);
    }
  }

  renderTargetStreamUI() {
    const targetCodes = this.settings.targetLangs || ['en'];
    const targetInfos = targetCodes.map((code) => SUPPORTED_LANGUAGES[code] || SUPPORTED_LANGUAGES.en);

    // 1言語のみの場合はシンプル表示、2〜3言語の場合はタブ表示
    if (this.targetBoxFlag) {
      this.targetBoxFlag.textContent = targetInfos.length === 1 ? targetInfos[0].flag : '🌐';
    }
    if (this.targetBoxTitle) {
      this.targetBoxTitle.textContent =
        targetInfos.length === 1
          ? targetInfos[0].targetBoxTitle
          : `同時通訳 (${targetInfos.map((t) => t.flag + ' ' + t.nameJa).join(' / ')})`;
    }

    if (this.targetLangTabs) {
      this.targetLangTabs.innerHTML = '';
      if (targetCodes.length > 1) {
        // 並列モードタブ
        const parallelTab = document.createElement('button');
        parallelTab.type = 'button';
        parallelTab.className = `target-tab ${this.currentViewTargetLang === 'all' ? 'active' : ''}`.trim();
        parallelTab.textContent = `📋 全言語表示 (縦並び)`;
        parallelTab.addEventListener('click', () => {
          this.currentViewTargetLang = 'all';
          this.renderTargetStreamUI();
          this.rebuildContinuousBoxesFromHistory();
        });
        this.targetLangTabs.appendChild(parallelTab);

        // 各言語個別タブ
        for (const info of targetInfos) {
          const tab = document.createElement('button');
          tab.type = 'button';
          tab.className = `target-tab ${this.currentViewTargetLang === info.code ? 'active' : ''}`.trim();
          tab.textContent = `${info.flag} ${info.nameJa}`;
          tab.addEventListener('click', () => {
            this.currentViewTargetLang = info.code;
            this.renderTargetStreamUI();
            this.rebuildContinuousBoxesFromHistory();
          });
          this.targetLangTabs.appendChild(tab);
        }
      }
    }

    const isParallel = targetCodes.length > 1 && this.currentViewTargetLang === 'all';
    if (this.multiTargetStreams) {
      this.multiTargetStreams.className = `multi-target-streams ${
        isParallel ? 'parallel-mode' : ''
      }`.trim();
    }
    if (this.enSingleBox) {
      this.enSingleBox.classList.toggle('is-parallel-mode', isParallel);
    }
  }

  updateHeaderStatus() {
    const activeCount = this.glossary.filter((g) => g.enabled).length;
    if (this.activeGlossaryCount) {
      this.activeGlossaryCount.textContent = String(activeCount);
    }
    if (this.menuGlossaryCount) {
      this.menuGlossaryCount.textContent = String(activeCount);
    }

    const totalLearned =
      (this.feedbackRules?.length || 0) + (this.correctionExamples?.length || 0);
    if (this.activeFeedbackCount) {
      this.activeFeedbackCount.textContent = String(totalLearned);
    }

    if (this.churchNameBadge) {
      this.churchNameBadge.textContent = this.settings.churchName || '';
      this.churchNameBadge.hidden = !this.settings.churchName;
    }

    const learnedSuffix = totalLearned > 0 ? ` / 学習ルール ${totalLearned}件` : '';

    if (this.interpreter.hasApiKey()) {
      const activeModel = this.interpreter.getActiveModelName();
      this.apiStatusDot.className = 'status-dot status-connected';
      this.apiStatusDot.title = `Gemini API 接続設定済み (${activeModel})`;
      if (this.stageModelInfo) {
        const modeSuffix =
          this.settings.audioInputMode === 'gemini-live' ? ' / Live Audio' : ' / ⚡高速モード';
        this.stageModelInfo.textContent = `${activeModel}${modeSuffix} (用語 ${activeCount}語${learnedSuffix})`;
      }
    } else {
      this.apiStatusDot.className = 'status-dot status-demo';
      this.apiStatusDot.title = 'デモモード（APIキーを設定するとフルAI通訳が有効になります）';
      if (this.stageModelInfo) {
        this.stageModelInfo.textContent = `デモ通訳モード（教会用語 ${activeCount}語${learnedSuffix} 適用中 — 右上の「API・設定」からGemini APIキー登録可能）`;
      }
    }
  }

  updateCharCountBadge() {
    const totalJaChars = this.history.reduce((sum, item) => sum + (item.ja?.length || 0), 0);
    this.historyCountLabel.textContent = `${totalJaChars} 文字 (${this.history.length} 節)`;
  }

  populateSampleDropdown() {
    if (!this.sampleSegmentSelect) return;
    SAMPLE_SERMON_SEGMENTS.forEach((seg, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = `サンプル${idx + 1}: ${seg.title}`;
      this.sampleSegmentSelect.appendChild(opt);
    });
  }

  toggleSettingsMenu() {
    if (!this.settingsDropdownMenu) return;
    const isHidden = this.settingsDropdownMenu.hidden;
    this.settingsDropdownMenu.hidden = !isHidden;
    this.openSettingsMenuBtn?.setAttribute('aria-expanded', String(isHidden));
  }

  closeSettingsMenu() {
    if (!this.settingsDropdownMenu) return;
    this.settingsDropdownMenu.hidden = true;
    this.openSettingsMenuBtn?.setAttribute('aria-expanded', 'false');
  }

  bindEvents() {
    // 話す言語（マイク音声認識）の切替
    this.sourceLangSelect?.addEventListener('change', async () => {
      const nextSource = this.sourceLangSelect.value;
      this.settings.sourceLang = nextSource;

      // 通訳先言語に話す言語が含まれている場合は除外
      this.settings.targetLangs = (this.settings.targetLangs || []).filter((l) => l !== nextSource);
      if (this.settings.targetLangs.length === 0) {
        this.settings.targetLangs = [nextSource === 'ja' ? 'en' : 'ja'];
      }
      this.settings.targetLang = this.settings.targetLangs[0];

      this.interpreter.clearContext();
      this.saveSettings();
      this.rebuildContinuousBoxesFromHistory();

      if (this.isListening) {
        await this.stopMicrophoneInterpretation();
        await this.startMicrophoneInterpretation();
      }
    });

    this.pauseMicBtn?.addEventListener('click', () => this.togglePauseMicrophone());

    // 参加者用リアルタイム字幕 URL・QRコード発行モーダル
    this.openShareModalBtn?.addEventListener('click', () => this.openShareDialog());
    this.printQrPosterBtn?.addEventListener('click', () => this.printQrPoster());
    this.buildingSelect?.addEventListener('change', () => {
      const buildingId = this.buildingSelect.value;
      const building = HIROSHIMA_BUILDINGS.find((b) => b.id === buildingId) || HIROSHIMA_BUILDINGS[0];
      const firstRoomId = building?.rooms?.[0]?.id || 'chapel';
      this.settings.buildingId = building.id;
      this.settings.roomSlotId = firstRoomId;
      this.populateRoomSelect(building.id, firstRoomId);
      const newRoomId = buildHiroshimaRoomId(building.id, firstRoomId);
      this.setCustomRoomId(newRoomId);
    });
    this.roomSelect?.addEventListener('change', () => {
      const buildingId = this.buildingSelect?.value || this.settings.buildingId || 'hakushima';
      const roomSlotId = this.roomSelect.value || 'chapel';
      this.settings.buildingId = buildingId;
      this.settings.roomSlotId = roomSlotId;
      const newRoomId = buildHiroshimaRoomId(buildingId, roomSlotId);
      this.setCustomRoomId(newRoomId);
    });
    this.closeShareDialogBtn?.addEventListener('click', () => this.shareDialog.close());
    this.closeShareFooterBtn?.addEventListener('click', () => this.shareDialog.close());
    this.editRoomBtn?.addEventListener('click', () => {
      const current = this.getRoomId();
      const input = window.prompt('配信ルームIDを入力してください（半角英数字とハイフン、例: lds-0br8w5）', current);
      if (input !== null) {
        const cleaned = input.trim().replace(/[^a-zA-Z0-9_-]/g, '');
        if (!cleaned) {
          window.alert('有効なルームIDを入力してください（半角英数字とハイフン）。');
          return;
        }
        this.setCustomRoomId(cleaned);
      }
    });
    this.regenerateRoomBtn?.addEventListener('click', () => {
      if (window.confirm('配信ルームIDを更新しますか？（※これまでに発行したURLやQRコードは無効になり、新しいURLになります）')) {
        this.regenerateRoomId();
      }
    });

    // 礼拝シーン切替
    this.sceneModeSelect.addEventListener('change', () => {
      this.settings.sceneMode = this.sceneModeSelect.value;
      this.saveSettings();
    });

    // 画面レイアウト切替
    this.viewModeSelect.addEventListener('change', () => {
      document.body.dataset.viewMode = this.viewModeSelect.value;
      this.scrollToBottomIfAuto();
    });

    // 2つの枠の配置切替（左右2枠 / 上下2枠）
    this.streamLayoutTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-layout]');
      if (!btn) return;
      for (const tab of this.streamLayoutTabs.querySelectorAll('.layout-tab')) {
        tab.classList.toggle('active', tab === btn);
      }
      this.liveStage.dataset.boxLayout = btn.dataset.layout;
      this.applyBoxSplitRatio();
      this.scrollToBottomIfAuto();
    });

    // 日本語枠・英語枠のドラッグ＆ドロップによるサイズ調整
    this.initBoxSplitterResize();

    // 段落改行ボタン
    this.insertParagraphBtn.addEventListener('click', () => {
      this.insertParagraphBreak();
    });

    // 文字サイズ調整
    this.fontScaleRange.addEventListener('input', () => {
      const scale = parseFloat(this.fontScaleRange.value);
      this.settings.fontScale = scale;
      document.documentElement.style.setProperty('--subtitle-scale', String(scale));
      this.saveSettings();
    });

    // プロジェクター全画面モード
    this.projectorBtn.addEventListener('click', () => this.toggleProjectorMode(true));
    this.exitProjectorBtn.addEventListener('click', () => this.toggleProjectorMode(false));
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        this.toggleProjectorMode(!document.body.classList.contains('projector-mode'));
      } else if (e.key === 'Escape' && document.body.classList.contains('projector-mode')) {
        this.toggleProjectorMode(false);
      }
    });

    // 用語ハイライト表示ON/OFF
    this.highlightTermsCheckbox.addEventListener('change', () => {
      document.body.classList.toggle('hide-term-highlights', !this.highlightTermsCheckbox.checked);
    });

    // スクロール位置の監視（過去の文章を閲覧中は自動スクロールを一時停止）
    const handleScrollCheck = (el) => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom > 80) {
        this.autoScrollEnabled = false;
        this.scrollToLatestBtn.hidden = false;
      } else {
        this.autoScrollEnabled = true;
        this.scrollToLatestBtn.hidden = true;
      }
    };

    this.jaScrollContainer.addEventListener('scroll', () => handleScrollCheck(this.jaScrollContainer));
    this.enScrollContainer.addEventListener('scroll', () => handleScrollCheck(this.enScrollContainer));

    this.scrollToLatestBtn.addEventListener('click', () => {
      this.autoScrollEnabled = true;
      this.scrollToLatestBtn.hidden = true;
      this.scrollToBottom(true);
    });

    // マイク開始・停止
    this.micToggleBtn.addEventListener('click', () => {
      if (this.isListening) {
        this.stopMicrophoneInterpretation();
      } else {
        this.startMicrophoneInterpretation();
      }
    });

    // 各種設定ドロップダウンメニューの開閉とアクション
    this.openSettingsMenuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettingsMenu();
    });

    document.addEventListener('click', (e) => {
      if (this.settingsDropdownWrapper && !this.settingsDropdownWrapper.contains(e.target)) {
        this.closeSettingsMenu();
      }
    });

    this.menuExportTxtBtn?.addEventListener('click', () => {
      this.closeSettingsMenu();
      this.exportTranscriptLog();
    });

    this.menuFeedbackBtn?.addEventListener('click', () => {
      this.closeSettingsMenu();
      this.openFeedbackDialog();
    });

    this.menuGlossaryBtn?.addEventListener('click', () => {
      this.closeSettingsMenu();
      this.glossaryDialog?.showModal();
    });

    this.closeGlossaryDialogBtn?.addEventListener('click', () => {
      this.glossaryDialog?.close();
    });

    this.menuApiSettingsBtn?.addEventListener('click', () => {
      this.closeSettingsMenu();
      this.openSettingsDialog();
    });

    // 礼拝サンプルテスト実行（要素が存在する場合のみ）
    this.runSampleBtn?.addEventListener('click', () => {
      if (!this.sampleSegmentSelect) return;
      const idxStr = this.sampleSegmentSelect.value;
      const idx = idxStr === '' ? 0 : parseInt(idxStr, 10);
      const sample = SAMPLE_SERMON_SEGMENTS[idx] || SAMPLE_SERMON_SEGMENTS[0];
      if (sample.scene && this.sceneModeSelect.value !== sample.scene) {
        this.sceneModeSelect.value = sample.scene;
        this.settings.sceneMode = sample.scene;
        this.saveSettings();
      }
      let sampleInputText = sample.ja;
      if (this.settings.sourceLang === 'en') {
        sampleInputText = sample.fallbackEn || sample.ja;
      } else if (this.settings.sourceLang === 'tl') {
        sampleInputText = sample.tl || sample.fallbackEn || sample.ja;
      } else if (this.settings.sourceLang === 'id') {
        sampleInputText = sample.id || sample.fallbackEn || sample.ja;
      }
      this.processRecognizedJapaneseSentence(sampleInputText);
    });

    this.sampleSegmentSelect?.addEventListener('change', () => {
      if (this.sampleSegmentSelect.value !== '') {
        this.runSampleBtn?.click();
      }
    });

    // 手動テキスト入力による即時通訳（要素が存在する場合のみ）
    this.manualInputForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = this.manualJaInput?.value?.trim();
      if (!raw) return;
      if (this.manualJaInput) this.manualJaInput.value = '';
      this.processRecognizedJapaneseSentence(raw);
    });

    // コピー・テキストファイル出力・修正フィードバック学習・クリア
    this.copyJaOnlyBtn.addEventListener('click', () => this.copySingleBoxText('ja'));
    this.copyEnOnlyBtn.addEventListener('click', () => this.copySingleBoxText('en'));
    this.copyAllLogBtn.addEventListener('click', () => this.copyAllTranscript());
    this.exportLogBtn?.addEventListener('click', () => this.exportTranscriptLog());
    this.openFeedbackModalBtn?.addEventListener('click', () => this.openFeedbackDialog());
    this.toggleCompactModeBtn?.addEventListener('click', () => this.toggleCompactMode());

    // 通訳終了後バナーのボタン
    this.bannerExportTxtBtn.addEventListener('click', () => this.exportTranscriptLog());
    this.bannerOpenFeedbackBtn.addEventListener('click', () => this.openFeedbackDialog());
    this.dismissBannerBtn.addEventListener('click', () => {
      this.postSessionActionBanner.hidden = true;
    });

    // 通訳結果の修正・フィードバック学習ダイアログのイベント
    this.closeFeedbackDialogBtn.addEventListener('click', () => this.feedbackDialog.close());
    this.closeFeedbackFooterBtn.addEventListener('click', () => this.feedbackDialog.close());
    this.modalExportTxtBtn.addEventListener('click', () => this.exportTranscriptLog());
    this.importEditedTxtInput.addEventListener('change', (e) => this.importEditedTxtFile(e));
    this.applyFeedbackTextBtn.addEventListener('click', () => this.applyFeedbackText());
    this.applyEditedSegmentsBtn.addEventListener('click', () => this.applyEditedSegments());
    this.clearAllFeedbackMemoryBtn.addEventListener('click', () => {
      if (window.confirm('学習済みの通訳改善ルールと修正お手本メモリをすべて消去しますか？')) {
        this.feedbackRules = [];
        this.correctionExamples = [];
        this.saveFeedbackRules();
        this.saveCorrectionExamples();
        this.renderLearnedMemoryList();
      }
    });

    this.clearLogBtn.addEventListener('click', () => {
      this.clearHistory();
    });

    this.clearManualInputBtn?.addEventListener('click', () => {
      this.manualJaInput.value = '';
      this.manualJaInput.focus();
    });

    this.clearFeedbackInputBtn?.addEventListener('click', () => {
      this.sessionFeedbackTextarea.value = '';
      this.feedbackStatusMessage.hidden = true;
      this.sessionFeedbackTextarea.focus();
    });

    this.clearSermonExtractInputsBtn?.addEventListener('click', () => {
      this.sermonJaManuscriptInput.value = '';
      this.sermonEnManuscriptInput.value = '';
      this.currentSermonCandidates = [];
      this.sermonCandidatesListContainer.innerHTML = '';
      this.sermonCandidatesSection.hidden = true;
      this.sermonExtractStatusMsg.hidden = true;
      this.sermonJaManuscriptInput.focus();
    });

    // 用語集検索・カテゴリフィルタ
    this.glossarySearchInput.addEventListener('input', () => {
      this.searchQuery = this.glossarySearchInput.value.trim().toLowerCase();
      this.renderGlossary();
    });

    this.categoryFilterChips.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cat]');
      if (!btn) return;
      for (const chip of this.categoryFilterChips.querySelectorAll('.chip')) {
        chip.classList.toggle('active', chip === btn);
      }
      this.selectedCategory = btn.dataset.cat;
      this.renderGlossary();
    });

    // 用語追加モーダル & 説教原稿からの辞書抽出モーダルを開く
    this.openGlossaryModalBtn?.addEventListener('click', () => this.openTermDialog());
    this.addTermQuickBtn.addEventListener('click', () => this.openTermDialog());
    this.headerSermonExtractBtn?.addEventListener('click', () => this.openSermonExtractDialog());
    this.openSermonExtractBtn?.addEventListener('click', () => this.openSermonExtractDialog());
    this.closeSermonExtractDialogBtn?.addEventListener('click', () => this.sermonExtractDialog.close());
    this.closeSermonExtractFooterBtn?.addEventListener('click', () => this.sermonExtractDialog.close());
    this.fillSampleSermonPairBtn?.addEventListener('click', () => this.fillSampleSermonPair());
    this.runSermonExtractBtn?.addEventListener('click', () => this.runSermonGlossaryExtraction());
    this.registerSelectedCandidatesBtn?.addEventListener('click', () => this.registerSelectedSermonCandidates());
    this.closeTermDialogBtn.addEventListener('click', () => this.termDialog.close());
    this.cancelTermDialogBtn.addEventListener('click', () => this.termDialog.close());

    this.termForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveTermFromDialog();
    });

    // CSV出力・読込・初期値リセット・GitHubバックアップ
    this.backupGlossaryGithubBtn?.addEventListener('click', () => this.backupGlossaryToGithub());
    this.restoreGlossaryGithubBtn?.addEventListener('click', () => this.restoreGlossaryFromGithub());
    this.exportGlossaryCsvBtn.addEventListener('click', () => this.exportGlossaryCsv());
    this.importGlossaryFileInput.addEventListener('change', (e) => this.importGlossaryFile(e));
    this.resetGlossaryBtn.addEventListener('click', () => {
      if (window.confirm('教会用語集を初期プリセット（プロテスタント標準用語）に戻しますか？')) {
        this.glossary = structuredClone(DEFAULT_PROTESTANT_GLOSSARY);
        this.saveGlossary();
        this.renderGlossary();
      }
    });

    // API・環境設定ダイアログ
    this.openSettingsBtn?.addEventListener('click', () => this.openSettingsDialog());
    this.closeSettingsDialogBtn.addEventListener('click', () => this.settingsDialog.close());
    this.cancelSettingsBtn.addEventListener('click', () => this.settingsDialog.close());

    this.toggleApiKeyVisibilityBtn.addEventListener('click', () => {
      const isPwd = this.apiKeyInput.type === 'password';
      this.apiKeyInput.type = isPwd ? 'text' : 'password';
      this.toggleApiKeyVisibilityBtn.textContent = isPwd ? '隠す' : '表示';
    });

    this.testApiConnectionBtn.addEventListener('click', async () => {
      const tempKey = this.apiKeyInput.value.trim();
      if (!tempKey) {
        this.apiTestResultBox.style.color = '#dc2626';
        this.apiTestResultBox.textContent = '⚠️ APIキーを入力してから「接続テスト」を押してください。';
        return;
      }
      this.testApiConnectionBtn.disabled = true;
      this.apiTestResultBox.style.color = '#2563eb';
      this.apiTestResultBox.textContent = '🔄 Gemini API への接続と応答速度を計測中...';
      try {
        this.interpreter.configure({
          apiKey: tempKey,
          model: this.geminiModelSelect.value,
          sceneMode: this.settings.sceneMode,
          churchName: this.churchNameInput.value.trim(),
        });
        const res = await this.interpreter.testConnection(this.glossary);
        this.apiTestResultBox.style.color = '#16a34a';
        this.apiTestResultBox.textContent = `✅ 接続成功！ (動作モデル: ${res.activeModel} / 応答時間: ${res.elapsedMs}ms) テスト訳: "${res.sampleTranslation}"`;
        this.updateHeaderStatus();
      } catch (err) {
        this.apiTestResultBox.style.color = '#dc2626';
        this.apiTestResultBox.textContent = `❌ 接続エラー: ${err?.message || 'APIキーまたは通信環境をご確認ください'}`;
      } finally {
        this.testApiConnectionBtn.disabled = false;
      }
    });

    this.toggleGithubTokenVisibilityBtn?.addEventListener('click', () => {
      const isPw = this.githubTokenInput.type === 'password';
      this.githubTokenInput.type = isPw ? 'text' : 'password';
      this.toggleGithubTokenVisibilityBtn.textContent = isPw ? '隠す' : '表示';
    });

    this.settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.settings.apiKey = this.apiKeyInput.value.trim();
      this.settings.model = this.geminiModelSelect.value;
      if (this.ttsModelSelect) {
        this.settings.ttsModel = this.ttsModelSelect.value;
      }
      if (this.ttsVoiceSelect) {
        this.settings.ttsVoice = this.ttsVoiceSelect.value;
      }
      this.settings.audioInputMode = this.audioInputModeSelect.value;
      this.settings.churchName = this.churchNameInput.value.trim();
      this.settings.autoCommitLength = Math.max(
        20,
        parseInt(this.autoCommitLengthInput.value, 10) || 42
      );
      this.settings.githubRepo = (this.githubRepoInput?.value.trim() || 'kmats1014/lds-interpret').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
      this.settings.githubToken = this.githubTokenInput?.value.trim() || '';
      this.saveSettings();
      this.settingsDialog.close();
    });
  }

  toggleProjectorMode(enable) {
    document.body.classList.toggle('projector-mode', enable);
    if (enable && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (!enable && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    this.applyBoxSplitRatio();
    this.scrollToBottomIfAuto();
  }

  toggleCompactMode(forceState = null) {
    const isCompact = forceState !== null ? forceState : !document.body.classList.contains('compact-mode');
    document.body.classList.toggle('compact-mode', isCompact);
    if (this.compactBtnIcon) {
      this.compactBtnIcon.textContent = isCompact ? '🔽' : '🔼';
    }
    if (this.compactBtnText) {
      this.compactBtnText.textContent = isCompact ? '展開' : '最小化';
    }
    if (this.toggleCompactModeBtn) {
      this.toggleCompactModeBtn.title = isCompact
        ? '操作メニューを展開して表示します'
        : '操作メニューを最小化し、通訳画面を縦いっぱいに広げます';
    }
    this.scrollToBottomIfAuto();
  }

  applyBoxSplitRatio(customRatio) {
    if (!this.twoBoxesWorkspace) return;
    const rawRatio = customRatio ?? this.settings.boxSplitRatio ?? 50;
    const ratio = Math.min(85, Math.max(15, Number(rawRatio) || 50));
    const isVertical = this.liveStage?.dataset.boxLayout === 'vertical';

    if (isVertical) {
      // 上下配置では上が英語(order:1)、下が日本語(order:3)
      this.twoBoxesWorkspace.style.setProperty('--en-box-fr', `${ratio}fr`);
      this.twoBoxesWorkspace.style.setProperty('--ja-box-fr', `${100 - ratio}fr`);
    } else {
      // 左右配置では左が日本語、右が英語
      this.twoBoxesWorkspace.style.setProperty('--ja-box-fr', `${ratio}fr`);
      this.twoBoxesWorkspace.style.setProperty('--en-box-fr', `${100 - ratio}fr`);
    }
  }

  initBoxSplitterResize() {
    if (!this.boxSplitter || !this.twoBoxesWorkspace) return;

    this.applyBoxSplitRatio();

    let isDragging = false;

    const updateFromPointer = (clientX, clientY) => {
      const rect = this.twoBoxesWorkspace.getBoundingClientRect();
      const isVertical = this.liveStage?.dataset.boxLayout === 'vertical';
      let pct = 50;

      if (isVertical) {
        if (rect.height <= 0) return;
        pct = ((clientY - rect.top) / rect.height) * 100;
      } else {
        if (rect.width <= 0) return;
        pct = ((clientX - rect.left) / rect.width) * 100;
      }

      const clamped = Math.min(85, Math.max(15, Math.round(pct * 10) / 10));
      this.settings.boxSplitRatio = clamped;
      this.applyBoxSplitRatio(clamped);
    };

    this.boxSplitter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      isDragging = true;
      this.boxSplitter.classList.add('is-dragging');
      document.body.classList.add('is-resizing-boxes');
      try {
        this.boxSplitter.setPointerCapture(e.pointerId);
      } catch {}
    });

    this.boxSplitter.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      updateFromPointer(e.clientX, e.clientY);
    });

    const stopDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      this.boxSplitter.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing-boxes');
      try {
        if (e && e.pointerId !== undefined) {
          this.boxSplitter.releasePointerCapture(e.pointerId);
        }
      } catch {}
      this.saveSettings();
      this.scrollToBottomIfAuto();
    };

    this.boxSplitter.addEventListener('pointerup', stopDrag);
    this.boxSplitter.addEventListener('pointercancel', stopDrag);

    // ダブルクリックで50:50の均等サイズにリセット
    this.boxSplitter.addEventListener('dblclick', () => {
      this.settings.boxSplitRatio = 50;
      this.applyBoxSplitRatio(50);
      this.saveSettings();
      this.scrollToBottomIfAuto();
    });
  }

  /* ==========================================================================
     Continuous Two-Box Microphone & Simultaneous Interpretation Pipeline
     ========================================================================== */
  async startMicrophoneInterpretation() {
    if (this.settings.audioInputMode === 'gemini-live') {
      await this.startGeminiLiveAudioMode();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(
        'お使いのブラウザはWeb Speech API音声認識に対応していません。Google Chrome または Microsoft Edge で開くか、設定から「Gemini Live API 直接音声ストリーム」を選択してください。'
      );
      return;
    }

    const srcInfo = this.interpreter.getSourceLangInfo();
    this.isListening = true;
    this.committedOffsets.clear();
    this.lastSpeechTimestamp = Date.now();
    this.updateMicUI(true, 'マイク接続中...', 'is-listening');

    // 2. 音声認識セッションの安全な生成と自動再起動ライフサイクル + 診断メッセージ表示
    let currentPendingInterim = '';
    let lastErrorType = '';

    const setDiagnosticPlaceholder = (htmlMsg) => {
      if (this.history.length === 0 && !currentPendingInterim && this.jaPlaceholderText) {
        this.jaPlaceholderText.style.display = 'inline';
        this.jaPlaceholderText.innerHTML = htmlMsg;
      }
    };

    const ua = navigator.userAgent;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const isBrave = Boolean(navigator.brave && (await navigator.brave.isBrave().catch(() => false)));
    if (isBrave) {
      setDiagnosticPlaceholder(
        '⚠️ <b>BraveブラウザはGoogle音声認識をブロックする場合があります。</b><br>音声が認識されない場合は Google Chrome または Microsoft Edge で開いてください。'
      );
    } else if (isSafari) {
      setDiagnosticPlaceholder(
        '⚠️ <b>Safariでは連続音声認識が不安定になる場合があります。</b><br>音声が認識されない場合は Google Chrome でのご利用を推奨します。（Macの「システム設定 > キーボード > 音声入力」がオンになっている必要があります）'
      );
    } else {
      setDiagnosticPlaceholder('🟡 音声認識エンジンを起動しています...');
    }

    const startRecognitionInstance = () => {
      if (!this.isListening) return;

      try {
        if (this.recognition) {
          this.recognition.onresult = null;
          this.recognition.onerror = null;
          this.recognition.onend = null;
          this.recognition.onstart = null;
          this.recognition.onaudiostart = null;
          this.recognition.onspeechstart = null;
          this.recognition.onspeechend = null;
          try { this.recognition.abort(); } catch {}
          this.recognition = null;
        }

        const rec = new SpeechRecognition();
        this.recognition = rec;
        rec.lang = srcInfo.speechLang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        rec.onstart = () => {
          if (!this.isListening) return;
          if (!lastErrorType) {
            this.liveStatusBadge.className = 'live-status-indicator is-listening';
            this.liveStatusText.textContent = `🟢 音声認識中（${srcInfo.nameJa}でお話しください）`;
            if (!isSafari && !isBrave) {
              setDiagnosticPlaceholder(
                `🟢 <b>音声認識が待機中です（認識言語: ${srcInfo.speechLang}）</b><br>マイクに向かってお話しください。話した内容がここにリアルタイムに表示されます...`
              );
            }
          }
        };

        rec.onaudiostart = () => {
          if (!this.isListening) return;
          if (!lastErrorType || lastErrorType === 'no-speech') {
            lastErrorType = '';
            this.liveStatusBadge.className = 'live-status-indicator is-listening';
            this.liveStatusText.textContent = `🟢 音声認識中（${srcInfo.nameJa}でお話しください）`;
            setDiagnosticPlaceholder(
              `🟢 <b>マイク入力を正常に取得しました（${srcInfo.speechLang}）</b><br>マイクに向かって話し始めると、ここに文字がリアルタイム表示されます...`
            );
          }
        };

        rec.onspeechstart = () => {
          if (!this.isListening) return;
          lastErrorType = '';
          this.liveStatusBadge.className = 'live-status-indicator is-listening';
          this.liveStatusText.textContent = '🎙️ 音声を検出中...';
          setDiagnosticPlaceholder('🎙️ <b>音声を検出しました！</b><br>認識結果を変換しています...');
        };

        rec.onspeechend = () => {
          if (!this.isListening) return;
          this.liveStatusBadge.className = 'live-status-indicator is-translating';
          this.liveStatusText.textContent = '⚡ 認識・通訳処理中...';
        };

        rec.onresult = (event) => {
          if (!this.isListening || this.isPaused) return;
          if (this.interimPauseTimer) {
            clearTimeout(this.interimPauseTimer);
            this.interimPauseTimer = null;
          }

          const now = Date.now();
          const isJapaneseSource = (this.settings.sourceLang || 'ja') === 'ja';
          // 7秒以上の無音があった場合は自然な段落改行を入れる
          const shouldBreakParagraph =
            this.history.length > 0 &&
            this.lastSpeechTimestamp > 0 &&
            now - this.lastSpeechTimestamp > 7000;
          this.lastSpeechTimestamp = now;

          if (shouldBreakParagraph) {
            this.insertParagraphBreak();
          }

          let latestActiveInterim = '';
          let latestActiveInterimIndex = -1;
          let latestActiveInterimRawLength = 0;

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const rawTranscript = result[0].transcript;
            const alreadyCommitted = this.committedOffsets.get(i) || 0;

            if (result.isFinal) {
              const remainingRaw = rawTranscript.slice(alreadyCommitted).trim();
              this.committedOffsets.delete(i);
              this.jaLiveInterimSpan.textContent = '';
              currentPendingInterim = '';
              if (remainingRaw.length > 0) {
                this.processRecognizedJapaneseSentence(remainingRaw);
              }
            } else {
              const activeInterim = rawTranscript.slice(alreadyCommitted);
              if (!activeInterim.trim()) continue;

              latestActiveInterim = activeInterim;
              latestActiveInterimIndex = i;
              latestActiveInterimRawLength = rawTranscript.length;

              if (isJapaneseSource) {
                // 日本語入力時: 句点または自然な文末・接続助詞で先行通訳
                const threshold = this.settings.autoCommitLength || 32;
                const sentenceEndMatch = activeInterim.match(/^(.{4,}?[。！？])/);
                const naturalClauseMatch =
                  activeInterim.length >= threshold
                    ? activeInterim.match(
                        /^(.{16,}?(?:[、。！？\s]|ました|ません|です|ます|でした|けれど|から|ので|祈ります|賛美します))(?![一-龠ぁ-ん])/
                      )
                    : null;

                const matchedPrefix =
                  sentenceEndMatch?.[1] ||
                  naturalClauseMatch?.[1] ||
                  (activeInterim.length >= threshold + 20 ? activeInterim : null);

                if (matchedPrefix) {
                  const newOffset = alreadyCommitted + matchedPrefix.length;
                  this.committedOffsets.set(i, newOffset);
                  latestActiveInterim = rawTranscript.slice(newOffset);
                  currentPendingInterim = latestActiveInterim.trim();
                  this.processRecognizedJapaneseSentence(matchedPrefix.trim());
                }
              } else {
                // 英語・タガログ語・インドネシア語などのスペース区切り言語入力時
                const sentenceEndMatch = activeInterim.match(/^(.{10,}?[.!?])\s+/);
                const clauseMatch =
                  activeInterim.length >= 65
                    ? activeInterim.match(/^(.{35,}?(?:[,;:]|\band\b|\bbut\b|\bbecause\b|\bthat\b|\bsapagkat\b|\bdan\b|\bkarena\b))\s+/i)
                    : null;
                const matchedPrefix = sentenceEndMatch?.[1] || clauseMatch?.[1] || null;

                if (matchedPrefix) {
                  const newOffset = alreadyCommitted + matchedPrefix.length;
                  this.committedOffsets.set(i, newOffset);
                  latestActiveInterim = rawTranscript.slice(newOffset);
                  currentPendingInterim = latestActiveInterim.trim();
                  this.processRecognizedJapaneseSentence(matchedPrefix.trim());
                }
              }
            }
          }

          if (latestActiveInterim.trim()) {
            currentPendingInterim = latestActiveInterim.trim();
            this.jaPlaceholderText.style.display = 'none';
            const previewNormalized = isJapaneseSource
              ? normalizeChurchSpeechText(latestActiveInterim, this.glossary)
              : latestActiveInterim;
            this.jaLiveInterimSpan.textContent = previewNormalized;
            this.scrollToBottomIfAuto();

            // 話し手が 0.9秒 息継ぎ・ポーズしたら確定文として通訳を開始（同じresultIndexの既送信位置を保持し重複防止）
            const commitIdx = latestActiveInterimIndex;
            const commitRawLen = latestActiveInterimRawLength;
            clearTimeout(this.interimPauseTimer);
            this.interimPauseTimer = setTimeout(() => {
              if (!this.isListening || this.isPaused) return;
              const textToCommit = currentPendingInterim.trim();
              if (textToCommit) {
                currentPendingInterim = '';
                if (commitIdx >= 0) {
                  this.committedOffsets.set(commitIdx, commitRawLen);
                }
                this.jaLiveInterimSpan.textContent = '';
                this.processRecognizedJapaneseSentence(textToCommit);
              }
            }, 900);
          } else {
            this.jaLiveInterimSpan.textContent = '';
          }
        };

        rec.onerror = (event) => {
          console.warn('SpeechRecognition error:', event.error);
          lastErrorType = event.error || 'unknown';
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            this.liveStatusBadge.className = 'live-status-indicator';
            this.liveStatusText.textContent = '❌ マイクの利用許可が必要です';
            setDiagnosticPlaceholder(
              '❌ <b>マイクへのアクセスが許可されていません。</b><br>ブラウザのアドレスバー左のアイコン（鍵マーク等）からマイクを「許可」し、Macの「システム設定 > プライバシーとセキュリティ > マイク」もオンにしてください。'
            );
            this.stopMicrophoneInterpretation();
            alert('マイクへのアクセスが許可されていません。ブラウザのアドレスバー左側のアイコンからマイクを許可してください。');
          } else if (event.error === 'audio-capture') {
            this.liveStatusBadge.className = 'live-status-indicator';
            this.liveStatusText.textContent = '⚠️ マイクが見つかりません';
            setDiagnosticPlaceholder(
              '⚠️ <b>マイクから音声を取得できません (audio-capture)</b><br>Macの「システム設定 > サウンド > 入力」で正しいマイクが選択されているか、入力音量が0やミュートになっていないかご確認ください。'
            );
          } else if (event.error === 'network') {
            this.liveStatusBadge.className = 'live-status-indicator';
            this.liveStatusText.textContent = '⚠️ 音声サーバー通信エラー';
            setDiagnosticPlaceholder(
              '⚠️ <b>音声認識サーバー（Google）への接続エラー (network)</b><br>インターネット接続やVPN・ファイアウォール、またはBrave等のブラウザ設定でGoogle音声サーバーがブロックされていないかご確認ください。'
            );
          } else if (event.error === 'no-speech') {
            setDiagnosticPlaceholder(
              '🟡 <b>音声が検出されません（待機中）</b><br>マイクに向かって声を出してください。反応しない場合はマイクがミュートになっていないかご確認ください。'
            );
          } else {
            this.liveStatusBadge.className = 'live-status-indicator';
            this.liveStatusText.textContent = `⚠️ 音声エラー (${event.error})`;
            setDiagnosticPlaceholder(`⚠️ <b>音声認識エラーが発生しました: ${event.error}</b>`);
          }
        };

        rec.onend = () => {
          if (!this.isListening) return;

          // 未確定の保留テキストがあれば即座に確定して通訳を漏らさない（一時停止中を除く）
          const flushText = currentPendingInterim.trim();
          if (flushText && !this.isPaused) {
            currentPendingInterim = '';
            this.jaLiveInterimSpan.textContent = '';
            this.processRecognizedJapaneseSentence(flushText);
          } else {
            currentPendingInterim = '';
            this.jaLiveInterimSpan.textContent = '';
          }

          // network / audio-capture エラー時は診断メッセージが読めるよう長めの間隔で再試行
          const delayMs =
            lastErrorType === 'network' || lastErrorType === 'audio-capture' ? 2500 : 200;

          clearTimeout(this.recRestartTimer);
          this.recRestartTimer = setTimeout(() => {
            if (this.isListening) {
              startRecognitionInstance();
            }
          }, delayMs);
        };

        rec.start();
      } catch (err) {
        console.warn('SpeechRecognition start failed, retrying in 500ms:', err);
        this.liveStatusBadge.className = 'live-status-indicator';
        this.liveStatusText.textContent = `⚠️ 起動待機中 (${err.message || '再試行中'})`;
        clearTimeout(this.recRestartTimer);
        this.recRestartTimer = setTimeout(() => {
          if (this.isListening) {
            startRecognitionInstance();
          }
        }, 500);
      }
    };

    startRecognitionInstance();
  }

  async startGeminiLiveAudioMode() {
    try {
      this.isListening = true;
      this.updateMicUI(true, 'Gemini Live API 接続中...', 'is-translating');

      let liveJaBuffer = '';
      let liveEnBuffer = '';
      let activeRefs = null;

      await this.interpreter.startLiveAudioSession({
        glossaryList: this.glossary,
        onStatusChange: (status) => {
          if (status === 'connected') {
            this.updateMicUI(true, 'Gemini Live 音声ストリーム通訳中', 'is-listening');
          } else if (status === 'closed' && this.isListening) {
            this.stopMicrophoneInterpretation();
          }
        },
        onInputTranscript: (jaChunk) => {
          liveJaBuffer += jaChunk;
          const normalized = normalizeChurchSpeechText(liveJaBuffer, this.glossary);
          if (!activeRefs) {
            const matched = this.interpreter.findMatchedGlossaryTerms(normalized, this.glossary);
            activeRefs = this.appendContinuousSegmentNodes(normalized, matched);
          } else {
            activeRefs.jaSpan.innerHTML = this.highlightJapaneseTerms(this.ensureJaPunctuation(normalized));
          }
          this.scrollToBottomIfAuto();
        },
        onOutputTranscript: (enChunk, turnComplete) => {
          liveEnBuffer += enChunk;
          const normalized = normalizeChurchSpeechText(liveJaBuffer, this.glossary) || '';
          const matched = this.interpreter.findMatchedGlossaryTerms(normalized, this.glossary);

          if (!activeRefs) {
            activeRefs = this.appendContinuousSegmentNodes(normalized, matched);
          }
          activeRefs.enSpan.innerHTML = this.highlightEnglishTerms(liveEnBuffer, matched) + ' ';
          this.scrollToBottomIfAuto();

          if (turnComplete && liveEnBuffer.trim()) {
            this.finalizeContinuousSegment(activeRefs, {
              ja: normalized,
              en: liveEnBuffer.trim(),
              matchedTerms: matched,
            });
            activeRefs = null;
            liveJaBuffer = '';
            liveEnBuffer = '';
          }
        },
        onError: (err) => {
          console.error('Gemini Live Error:', err);
          alert(`Gemini Live API エラー: ${err?.message || '接続に失敗しました'}`);
          this.stopMicrophoneInterpretation();
        },
      });
    } catch (err) {
      this.isListening = false;
      this.updateMicUI(false, '待機中', '');
      alert(err.message || 'Gemini Live API の開始に失敗しました。');
    }
  }

  async stopMicrophoneInterpretation() {
    this.isListening = false;
    clearTimeout(this.recRestartTimer);
    if (this.interimPauseTimer) {
      clearTimeout(this.interimPauseTimer);
      this.interimPauseTimer = null;
    }
    this.jaLiveInterimSpan.textContent = '';
    if (this.recognition) {
      try {
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {}
      this.recognition = null;
    }

    if (this.audioMonitorStream) {
      try {
        this.audioMonitorStream.getTracks().forEach((track) => track.stop());
      } catch {}
      this.audioMonitorStream = null;
    }
    if (this.audioMonitorContext) {
      try {
        this.audioMonitorContext.close();
      } catch {}
      this.audioMonitorContext = null;
    }
    if (this.audioMonitorRaf) {
      cancelAnimationFrame(this.audioMonitorRaf);
      this.audioMonitorRaf = null;
    }

    await this.interpreter.stopLiveAudioSession();
    this.updateMicUI(false, '待機中', '');

    // 通訳終了時に内容がある場合は「テキスト出力(.txt) / 修正・フィードバック学習」案内バーを表示
    if (this.history.length > 0 && this.postSessionActionBanner) {
      this.postSessionActionBanner.hidden = false;
    }
  }

  updateMicUI(active, statusText, badgeStateClass) {
    this.micToggleBtn.setAttribute('aria-pressed', String(active));
    this.micBtnText.textContent = active
      ? '同時通訳を停止'
      : '同時通訳スタート';
    if (this.pauseMicBtn) {
      this.pauseMicBtn.disabled = !active;
      if (!active) {
        this.isPaused = false;
        this.pauseMicBtn.textContent = '⏸ 一時停止';
        this.pauseMicBtn.classList.remove('btn-primary');
        this.pauseMicBtn.classList.add('btn-outline');
      }
    }
    this.liveStatusBadge.className = `live-status-indicator ${badgeStateClass}`.trim();
    this.liveStatusText.textContent = statusText;
  }

  togglePauseMicrophone() {
    if (!this.isListening) return;
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      clearTimeout(this.interimPauseTimer);
      this.interimPauseTimer = null;
      this.jaLiveInterimSpan.textContent = '';
      if (this.pauseMicBtn) {
        this.pauseMicBtn.textContent = '▶️ 再開';
        this.pauseMicBtn.classList.remove('btn-outline');
        this.pauseMicBtn.classList.add('btn-primary');
      }
      this.liveStatusBadge.className = 'live-status-indicator';
      this.liveStatusText.textContent = '⏸ 一時停止中';
    } else {
      if (this.pauseMicBtn) {
        this.pauseMicBtn.textContent = '⏸ 一時停止';
        this.pauseMicBtn.classList.remove('btn-primary');
        this.pauseMicBtn.classList.add('btn-outline');
      }
      this.liveStatusBadge.className = 'live-status-indicator is-listening';
      this.liveStatusText.textContent = '🟢 音声認識を再開しました';
    }
  }

  /**
   * 確定した入力文を「書き起こし枠」の末尾に自然な一続きの文章として繋げ、
   * 同時に選択された最大3つの通訳先言語へ並列にリアルタイムストリーミング追記する
   */
  async processRecognizedJapaneseSentence(rawSourceText) {
    if (this.isPaused) return;
    const isJapaneseSource = (this.settings.sourceLang || 'ja') === 'ja';
    const normalizedSource = isJapaneseSource
      ? normalizeChurchSpeechText(rawSourceText, this.glossary)
      : rawSourceText.trim();
    if (!normalizedSource) return;

    // 1〜2文字の意味のない断片（賛美歌・雑音由来の助詞等）は翻訳に送らずスキップ
    const coreText = normalizedSource.replace(/[\s、。！？.,!?…\-ー「」『』()（）]/g, '');
    if (
      coreText.length <= 2 &&
      !/^(はい|いいえ|うん|アーメン|あーめん|Amen|Yes|No|Opo|Ya)$/i.test(coreText)
    ) {
      return;
    }

    // 直近3件のコミット済み文との重複チェック（Web Speech API の確定/途中書き換えによる二重送信防止）
    const recentEntries = this.history.filter((h) => !h.isParagraphBreak).slice(-3);
    for (const prev of recentEntries) {
      const prevCore = (prev.sourceText || prev.ja || '').replace(/[\s、。！？.,!?…\-ー]/g, '');
      if (!prevCore) continue;
      if (coreText === prevCore || (coreText.length >= 6 && prevCore.includes(coreText))) {
        return;
      }
    }

    this.liveStatusBadge.className = 'live-status-indicator is-translating';
    this.liveStatusText.textContent = '⚡ 複数言語同時通訳中...';

    const matchedPreview = this.interpreter.findMatchedGlossaryTerms(normalizedSource, this.glossary);
    this.populateTermChipsElement(this.latestMatchedTermsStrip, matchedPreview);

    const targetCodes = this.settings.targetLangs && this.settings.targetLangs.length > 0
      ? this.settings.targetLangs
      : ['en'];

    // 書き起こし枠と各通訳先言語パネルの末尾にインライン要素を追加
    const segRefs = this.appendContinuousSegmentNodes(normalizedSource, matchedPreview);

    try {
      const resultsMap = {};
      await this.interpreter.translateMultiLangStream(
        normalizedSource,
        targetCodes,
        this.glossary,
        (langCode, partialText) => {
          const targetSpan = segRefs.targetSpans?.[langCode];
          if (targetSpan) {
            targetSpan.innerHTML = this.highlightTargetTerms(partialText, matchedPreview, langCode) + ' ';
            this.scrollToBottomIfAuto();
          }
          // スマホ参加者ビューワーへリアルタイムストリーミング差分を配信
          this.broadcastToViewers({
            type: 'streaming',
            payload: { lang: langCode, text: partialText },
          });
        }
      ).then((res) => {
        for (const code of targetCodes) {
          resultsMap[code] = res[code]?.englishText || '';
        }
      });

      this.finalizeContinuousSegment(segRefs, {
        sourceText: normalizedSource,
        translations: resultsMap,
        matchedTerms: matchedPreview,
      });

      this.updateHeaderStatus();

      // 音声読み上げがONの場合は、第1ターゲット言語で読み上げ
      const primaryTarget = targetCodes[0] || 'en';
      if (this.ttsToggleCheckbox.checked && resultsMap[primaryTarget]) {
        this.speakTargetText(resultsMap[primaryTarget], primaryTarget);
      }
    } catch (err) {
      console.error('Translation error:', err);
      if (segRefs.targetSpans) {
        Object.values(segRefs.targetSpans).forEach((span) => {
          span.textContent = `[Error: ${err?.message || '通信エラー'}] `;
        });
      }
    } finally {
      if (this.isListening) {
        const srcInfo = this.interpreter.getSourceLangInfo();
        this.liveStatusBadge.className = 'live-status-indicator is-listening';
        this.liveStatusText.textContent = srcInfo.listeningHint;
      } else {
        this.liveStatusBadge.className = 'live-status-indicator';
        this.liveStatusText.textContent = '待機中';
      }
    }
  }

  ensureJaPunctuation(sourceText) {
    const trimmed = sourceText.trim();
    if (!trimmed) return '';
    const isJapanese = (this.settings.sourceLang || 'ja') === 'ja' || /[一-龠ぁ-んァ-ヶ]$/.test(trimmed);
    if (isJapanese) {
      if (/[。！？、…]$/.test(trimmed)) {
        return trimmed;
      }
      return trimmed + '。';
    }
    if (/[.!?…]$/.test(trimmed)) {
      return trimmed + ' ';
    }
    return trimmed + '. ';
  }

  /**
   * 書き起こし枠および選択中の通訳言語パネルの末尾にインラインの <span> を追加して一続きの文章にする
   */
  appendContinuousSegmentNodes(sourceText, matchedTerms = [], existingEntry = null) {
    this.jaPlaceholderText.style.display = 'none';
    this.enPlaceholderText.style.display = 'none';

    const formattedSource = this.ensureJaPunctuation(sourceText);

    // 左枠: 音声認識書き起こし
    const jaSpan = document.createElement('span');
    jaSpan.className = 'ja-committed-chunk';
    jaSpan.innerHTML = this.highlightJapaneseTerms(formattedSource);
    this.jaCommittedContainer.appendChild(jaSpan);

    // 右枠: 通訳先言語パネル群
    const targetCodes = this.settings.targetLangs && this.settings.targetLangs.length > 0
      ? this.settings.targetLangs
      : ['en'];

    this.ensureTargetStreamPanelsExist(targetCodes);

    const targetSpans = {};
    for (const code of targetCodes) {
      const panelBody = document.getElementById(`langPanelBody_${code}`);
      if (!panelBody) continue;

      const span = document.createElement('span');
      const textVal =
        existingEntry?.translations?.[code] ||
        (code === 'en' ? existingEntry?.en : '') ||
        '';

      if (textVal) {
        span.className = 'en-committed-chunk';
        span.innerHTML = this.highlightTargetTerms(textVal, matchedTerms, code) + ' ';
      } else {
        span.className = 'en-streaming-chunk';
        span.textContent = '… ';
      }
      panelBody.appendChild(span);
      targetSpans[code] = span;
    }

    this.scrollToBottomIfAuto();

    return {
      jaSpan,
      targetSpans,
      formattedSource,
      timeStr:
        existingEntry?.time ||
        new Date().toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
    };
  }

  ensureTargetStreamPanelsExist(targetCodes) {
    if (!this.multiTargetStreams) return;

    for (const code of targetCodes) {
      let panel = document.getElementById(`langPanel_${code}`);
      if (!panel) {
        const info = SUPPORTED_LANGUAGES[code] || SUPPORTED_LANGUAGES.en;
        panel = document.createElement('div');
        panel.id = `langPanel_${code}`;
        panel.className = 'lang-stream-panel';
        panel.dataset.langCode = code;

        const isCurrentActive =
          this.currentViewTargetLang === code ||
          (this.currentViewTargetLang === 'all' && targetCodes.includes(code)) ||
          (this.currentViewTargetLang !== 'all' && !targetCodes.includes(this.currentViewTargetLang) && code === targetCodes[0]);

        if (isCurrentActive) {
          panel.classList.add('active');
        }

        const panelHeader = document.createElement('div');
        panelHeader.className = 'parallel-panel-header';
        panelHeader.innerHTML = `<span>${info.flag} ${info.nameJa} (${info.nameEn})</span><span class="parallel-badge">同時通訳ストリーム</span>`;
        panel.appendChild(panelHeader);

        const panelBody = document.createElement('div');
        panelBody.id = `langPanelBody_${code}`;
        panelBody.className = `continuous-prose prose-target prose-${code}`;
        panel.appendChild(panelBody);

        this.multiTargetStreams.appendChild(panel);
      } else {
        const isCurrentActive =
          this.currentViewTargetLang === code ||
          (this.currentViewTargetLang === 'all' && targetCodes.includes(code)) ||
          (this.currentViewTargetLang !== 'all' && !targetCodes.includes(this.currentViewTargetLang) && code === targetCodes[0]);
        panel.classList.toggle('active', Boolean(isCurrentActive));
      }
    }

    // 選択されていない古い言語パネルは非表示
    for (const child of Array.from(this.multiTargetStreams.children)) {
      const code = child.dataset.langCode;
      if (code && !targetCodes.includes(code)) {
        child.classList.remove('active');
      }
    }
  }

  finalizeContinuousSegment(segRefs, { sourceText, translations, matchedTerms }) {
    const targetCodes = this.settings.targetLangs || ['en'];
    const primaryCode = targetCodes[0] || 'en';
    const cleanPrimary = (translations[primaryCode] || '').trim();

    for (const code of targetCodes) {
      const span = segRefs.targetSpans?.[code];
      const textVal = (translations[code] || '').trim();
      if (span && textVal) {
        span.className = 'en-committed-chunk';
        span.innerHTML = this.highlightTargetTerms(textVal, matchedTerms, code) + ' ';
      }
    }

    this.populateTermChipsElement(this.latestMatchedTermsStrip, matchedTerms);

    const entry = {
      id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: segRefs.timeStr,
      sourceText: segRefs.formattedSource,
      ja: segRefs.formattedSource, // 既存互換
      translations: translations || {},
      en: cleanPrimary, // 既存互換
      matchedTerms: matchedTerms || [],
    };

    this.history.push(entry);
    this.updateCharCountBadge();
    this.saveHistory();
    this.scrollToBottomIfAuto();

    // 接続中の参加者スマホへ確定文をブロードキャスト配信
    this.broadcastToViewers({
      type: 'new_segment',
      payload: entry,
    });

    // AI音声を購読中の参加者がいる言語だけ非同期でTTS音声を生成・配信
    this.dispatchViewerTtsForEntry(entry);
  }

  insertParagraphBreak() {
    if (this.jaCommittedContainer.childNodes.length === 0) return;
    this.jaCommittedContainer.appendChild(document.createTextNode('\n\n'));

    const targetCodes = this.settings.targetLangs || ['en'];
    for (const code of targetCodes) {
      const body = document.getElementById(`langPanelBody_${code}`);
      if (body) {
        body.appendChild(document.createTextNode('\n\n'));
      }
    }

    this.history.push({
      id: `br-${Date.now()}`,
      isParagraphBreak: true,
      sourceText: '\n\n',
      ja: '\n\n',
      translations: {},
      en: '\n\n',
      matchedTerms: [],
    });

    this.saveHistory();
    this.scrollToBottomIfAuto();

    this.broadcastToViewers({ type: 'paragraph_break' });
  }

  restoreSavedHistoryToStream() {
    if (!this.history || this.history.length === 0) {
      this.updateCharCountBadge();
      return;
    }

    this.jaPlaceholderText.style.display = 'none';
    this.enPlaceholderText.style.display = 'none';

    for (const entry of this.history) {
      if (entry.isParagraphBreak) {
        this.jaCommittedContainer.appendChild(document.createTextNode('\n\n'));
        const targetCodes = this.settings.targetLangs || ['en'];
        for (const code of targetCodes) {
          const body = document.getElementById(`langPanelBody_${code}`);
          if (body) {
            body.appendChild(document.createTextNode('\n\n'));
          }
        }
        if (this.enCommittedContainer) {
          this.enCommittedContainer.appendChild(document.createTextNode('\n\n'));
        }
        continue;
      }
      const source = entry.sourceText || entry.ja || '';
      this.appendContinuousSegmentNodes(source, entry.matchedTerms || [], entry);
      this.interpreter.pushContext(source, entry.en);
    }

    this.updateCharCountBadge();
    this.scrollToBottom(false);
  }

  populateTermChipsElement(container, matchedTerms = []) {
    container.innerHTML = '';
    if (!matchedTerms || matchedTerms.length === 0) return;

    for (const term of matchedTerms) {
      const chip = document.createElement('span');
      chip.className = 'matched-term-chip';
      chip.textContent = `📖 ${term.ja} ➔ ${term.PrimaryEn || term.en}`;
      container.appendChild(chip);
    }
  }

  scrollToBottomIfAuto() {
    if (this.autoScrollEnabled) {
      this.scrollToBottom(true);
    }
  }

  scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
      const behavior = smooth ? 'smooth' : 'auto';
      if (this.jaScrollContainer) {
        this.jaScrollContainer.scrollTo({ top: this.jaScrollContainer.scrollHeight, behavior });
      }
      if (this.enScrollContainer) {
        this.enScrollContainer.scrollTo({ top: this.enScrollContainer.scrollHeight, behavior });
      }
      const targetCodes = this.settings.targetLangs || ['en'];
      for (const code of targetCodes) {
        const body = document.getElementById(`langPanelBody_${code}`);
        if (body) {
          body.scrollTo({ top: body.scrollHeight, behavior });
        }
      }
    });
  }

  highlightJapaneseTerms(text) {
    let safeHtml = this.escapeHtml(text);
    const activeTerms = [...this.glossary].filter((t) => t.enabled && t.ja);

    if ((this.settings.sourceLang || 'ja') === 'ja' || /[一-龠ぁ-んァ-ヶ]/.test(text)) {
      activeTerms.sort((a, b) => b.ja.length - a.ja.length);
      for (const term of activeTerms) {
        const escapedJa = this.escapeHtml(term.ja);
        if (safeHtml.includes(escapedJa)) {
          safeHtml = safeHtml.replaceAll(
            escapedJa,
            `<mark class="glossary-highlight" title="登録訳語: ${this.escapeHtml(term.en)}">${escapedJa}</mark>`
          );
        }
      }
      return safeHtml;
    }

    // 英語入力時: 登録されている英語用語をハイライト
    const enCandidates = [];
    for (const term of activeTerms) {
      const primary = (term.en || '').replace(/\s*\(.*?\)\s*/g, '').trim();
      for (const sub of primary.split('/')) {
        const clean = sub.trim();
        if (clean.length >= 3) {
          enCandidates.push({ en: clean, ja: term.ja });
        }
      }
    }
    enCandidates.sort((a, b) => b.en.length - a.en.length);
    for (const cand of enCandidates) {
      const pattern = new RegExp(`(${this.escapeRegExp(cand.en)})`, 'gi');
      safeHtml = safeHtml.replace(
        pattern,
        `<mark class="glossary-highlight" title="登録日本語訳: ${this.escapeHtml(cand.ja)}">$1</mark>`
      );
    }
    return safeHtml;
  }

  highlightEnglishTerms(text, matchedTerms = []) {
    return this.highlightTargetTerms(text, matchedTerms, this.settings.targetLang || 'en');
  }

  highlightTargetTerms(text, matchedTerms = [], targetLangCode = 'en') {
    let safeHtml = this.escapeHtml(text);
    if (!matchedTerms || matchedTerms.length === 0) return safeHtml;

    // 通訳先が日本語の場合（英→日など）は、日本語訳された教会用語をハイライト
    if (targetLangCode === 'ja' || /[一-龠ぁ-んァ-ヶ]/.test(text)) {
      const sortedJa = [...matchedTerms].sort((a, b) => (b.ja?.length || 0) - (a.ja?.length || 0));
      for (const term of sortedJa) {
        const escapedJa = this.escapeHtml(term.ja);
        if (escapedJa && safeHtml.includes(escapedJa)) {
          safeHtml = safeHtml.replaceAll(
            escapedJa,
            `<mark class="glossary-highlight" title="教会用語: ${this.escapeHtml(term.PrimaryEn || term.en)}">${escapedJa}</mark>`
          );
        }
      }
      return safeHtml;
    }

    const candidates = [];
    for (const term of matchedTerms) {
      const primary = (term.PrimaryEn || term.en).trim();
      if (primary.length >= 3) candidates.push({ en: primary, ja: term.ja });
      if (primary.includes('/')) {
        for (const sub of primary.split('/')) {
          if (sub.trim().length >= 3) {
            candidates.push({ en: sub.trim(), ja: term.ja });
          }
        }
      }
    }

    candidates.sort((a, b) => b.en.length - a.en.length);

    for (const cand of candidates) {
      const pattern = new RegExp(`(${this.escapeRegExp(cand.en)})`, 'gi');
      safeHtml = safeHtml.replace(
        pattern,
        `<mark class="glossary-highlight" title="教会用語: ${this.escapeHtml(cand.ja)}">$1</mark>`
      );
    }
    return safeHtml;
  }

  speakEnglishText(text) {
    this.speakTargetText(text, this.settings.targetLang || 'en');
  }

  speakTargetText(text, langCode = 'en') {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/\[.*?\]/g, '').trim();
      if (!cleanText) return;
      const tgtInfo = SUPPORTED_LANGUAGES[langCode] || SUPPORTED_LANGUAGES.en;
      const utter = new SpeechSynthesisUtterance(cleanText);
      utter.lang = tgtInfo.ttsLang || 'en-US';
      utter.rate = 1.02;
      window.speechSynthesis.speak(utter);
    } catch {}
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
    this.interpreter.clearContext();
    this.committedOffsets.clear();
    this.jaCommittedContainer.innerHTML = '';
    this.jaLiveInterimSpan.textContent = '';
    if (this.multiTargetStreams) {
      this.multiTargetStreams.innerHTML = '';
    }
    this.latestMatchedTermsStrip.innerHTML = '';
    if (this.manualJaInput) {
      this.manualJaInput.value = '';
    }
    if (this.sampleSegmentSelect) {
      this.sampleSegmentSelect.value = '';
    }
    this.jaPlaceholderText.style.display = 'inline';
    this.enPlaceholderText.style.display = 'inline';
    this.updateCharCountBadge();
    this.autoScrollEnabled = true;
    this.scrollToLatestBtn.hidden = true;
    if (this.postSessionActionBanner) {
      this.postSessionActionBanner.hidden = true;
    }

    this.broadcastToViewers({ type: 'clear' });
  }

  rebuildContinuousBoxesFromHistory() {
    this.jaCommittedContainer.innerHTML = '';
    if (this.multiTargetStreams) {
      this.multiTargetStreams.innerHTML = '';
    }

    const targetCodes = this.settings.targetLangs && this.settings.targetLangs.length > 0
      ? this.settings.targetLangs
      : ['en'];
    this.ensureTargetStreamPanelsExist(targetCodes);

    if (!this.history || this.history.length === 0) {
      this.jaPlaceholderText.style.display = 'inline';
      this.enPlaceholderText.style.display = 'inline';
      this.updateCharCountBadge();
      return;
    }

    this.jaPlaceholderText.style.display = 'none';
    this.enPlaceholderText.style.display = 'none';

    for (const entry of this.history) {
      if (entry.isParagraphBreak) {
        this.jaCommittedContainer.appendChild(document.createTextNode('\n\n'));
        for (const code of targetCodes) {
          const body = document.getElementById(`langPanelBody_${code}`);
          if (body) body.appendChild(document.createTextNode('\n\n'));
        }
        continue;
      }
      const source = entry.sourceText || entry.ja || '';
      const matched = this.interpreter.findMatchedGlossaryTerms(source, this.glossary);
      entry.matchedTerms = matched;
      this.appendContinuousSegmentNodes(source, matched, entry);
    }
    this.updateCharCountBadge();
  }

  /* ==========================================================================
     P2P Live Broadcast & Share Viewer QR / URL
     ========================================================================== */
  getRoomId() {
    const urlRoom = new URLSearchParams(window.location.search).get('room');
    if (urlRoom && /^[a-zA-Z0-9_-]+$/.test(urlRoom.trim())) {
      const cleaned = urlRoom.trim();
      if (this.settings.roomId !== cleaned) {
        this.settings.roomId = cleaned;
        this.saveSettings();
      }
      return cleaned;
    }
    if (!this.settings.roomId) {
      this.settings.roomId = 'lds-' + Math.random().toString(36).slice(2, 8);
      this.saveSettings();
    }
    return this.settings.roomId;
  }

  setCustomRoomId(newRoomId) {
    this.settings.roomId = newRoomId;
    this.saveSettings();
    this.initHostPeer();
    this.openShareDialog();
  }

  regenerateRoomId() {
    this.settings.roomId = 'lds-' + Math.random().toString(36).slice(2, 8);
    this.saveSettings();
    this.initHostPeer();
    this.openShareDialog();
  }

  initHostPeer() {
    if (typeof mqtt === 'undefined') {
      console.warn('MQTT library not loaded.');
      return;
    }

    if (this.mqttClient) {
      try {
        this.mqttClient.end(true);
      } catch {}
      this.mqttClient = null;
    }
    clearInterval(this._mqttPresenceTimer);
    clearInterval(this._mqttPruneTimer);

    this.activeViewerMap = new Map(); // clientId -> lastSeenMs
    this.updateConnectedPeersCount();

    const roomId = this.getRoomId();
    const locMeta = this.getCurrentLocationMeta();
    const topicPrefix = `lds-interpret/room/${roomId}`;
    this._mqttStreamTopic = `${topicPrefix}/stream`;
    this._mqttPresenceTopic = `${topicPrefix}/presence`;
    const ctrlTopic = `${topicPrefix}/ctrl`;

    if (this.roomConflictBadge) {
      this.roomConflictBadge.hidden = true;
    }

    const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
    const clientId = `lds-host-${roomId}-${Math.random().toString(36).slice(2, 7)}`;

    const publishPresence = (online) => {
      if (!this.mqttClient || !this.mqttClient.connected) return;
      try {
        this.mqttClient.publish(
          this._mqttPresenceTopic,
          JSON.stringify({
            online,
            ts: Date.now(),
            roomId,
            hostId: this.hostInstanceId,
            buildingId: locMeta.buildingId,
            roomSlotId: locMeta.roomSlotId,
            buildingName: locMeta.buildingNameJa,
            buildingNameEn: locMeta.buildingNameEn,
            roomName: locMeta.roomNameJa,
            roomNameEn: locMeta.roomNameEn,
          }),
          { retain: true, qos: 1 }
        );
      } catch {}
    };

    try {
      this.mqttClient = mqtt.connect(brokerUrl, {
        clientId,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 3000,
        keepalive: 25,
        timerVariant: 'native',
        will: {
          topic: this._mqttPresenceTopic,
          payload: JSON.stringify({
            online: false,
            ts: Date.now(),
            roomId,
            hostId: this.hostInstanceId,
          }),
          qos: 1,
          retain: true,
        },
      });

      this.mqttClient.on('connect', () => {
        if (this.shareLiveDot) {
          this.shareLiveDot.style.background = 'var(--live-green)';
          this.shareLiveDot.title = `配信中 (Room: ${roomId})`;
        }
        this.mqttClient.subscribe([ctrlTopic, this._mqttPresenceTopic], { qos: 0 });
        publishPresence(true);

        clearInterval(this._mqttPresenceTimer);
        this._mqttPresenceTimer = setInterval(() => {
          publishPresence(true);
        }, 20000);
      });

      this.mqttClient.on('message', (topic, message) => {
        if (topic === this._mqttPresenceTopic) {
          try {
            const p = JSON.parse(message.toString());
            if (p && p.hostId && p.hostId !== this.hostInstanceId) {
              const isOtherAlive = Boolean(p.online) && Date.now() - (p.ts || 0) < 45000;
              if (this.roomConflictBadge) {
                this.roomConflictBadge.hidden = !isOtherAlive;
              }
            }
          } catch {}
          return;
        }
        if (topic !== ctrlTopic) return;
        try {
          const data = JSON.parse(message.toString());
          if (!data || !data.clientId) return;

          if (data.type === 'hello' || data.type === 'ping') {
            this.activeViewerMap.set(data.clientId, Date.now());
            if (data.audioEnabled && data.lang) {
              this.viewerAudioSubscribers.set(data.clientId, {
                lang: data.lang,
                updatedAt: Date.now(),
              });
            }
            this.updateConnectedPeersCount();
            if (data.type === 'hello') {
              // 新規接続クライアントへ現在の履歴を配信
              this.broadcastToViewers({
                type: 'history',
                payload: this.history.slice(-80),
                targetClient: data.clientId,
              });
            }
          } else if (data.type === 'audio_sub') {
            this.activeViewerMap.set(data.clientId, Date.now());
            if (data.enabled && data.lang) {
              this.viewerAudioSubscribers.set(data.clientId, {
                lang: data.lang,
                updatedAt: Date.now(),
              });
            } else {
              this.viewerAudioSubscribers.delete(data.clientId);
            }
          } else if (data.type === 'bye') {
            this.activeViewerMap.delete(data.clientId);
            this.viewerAudioSubscribers.delete(data.clientId);
            this.updateConnectedPeersCount();
          }
        } catch {}
      });

      this.mqttClient.on('reconnect', () => {
        if (this.shareLiveDot) {
          this.shareLiveDot.style.background = '#f59e0b';
          this.shareLiveDot.title = '配信サーバーへ再接続中...';
        }
      });

      this.mqttClient.on('error', (err) => {
        console.warn('Host MQTT error:', err?.message || err);
        if (this.shareLiveDot) {
          this.shareLiveDot.style.background = '#f59e0b';
        }
      });

      // 45秒以上応答がない視聴者を接続カウントから除外
      this._mqttPruneTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [cid, lastSeen] of this.activeViewerMap.entries()) {
          if (now - lastSeen > 45000) {
            this.activeViewerMap.delete(cid);
            this.viewerAudioSubscribers.delete(cid);
            changed = true;
          }
        }
        if (changed) {
          this.updateConnectedPeersCount();
        }
      }, 15000);

      if (!this._peerUnloadBound) {
        window.addEventListener('beforeunload', () => {
          publishPresence(false);
          try { this.mqttClient?.end(true); } catch {}
        });
        this._peerUnloadBound = true;
      }
    } catch (err) {
      console.error('Failed to init MQTT host:', err);
    }
  }

  updateConnectedPeersCount() {
    const count = this.activeViewerMap ? this.activeViewerMap.size : 0;
    if (this.connectedPeersCountLabel) {
      this.connectedPeersCountLabel.textContent = `👥 接続中: ${count}人`;
      this.connectedPeersCountLabel.style.background = count > 0 ? '#bbf7d0' : '#dcfce7';
      this.connectedPeersCountLabel.style.color = count > 0 ? '#15803d' : '#166534';
    }
  }

  broadcastToViewers(message) {
    if (!this.mqttClient || !this.mqttClient.connected || !this._mqttStreamTopic) return;
    try {
      this.mqttClient.publish(this._mqttStreamTopic, JSON.stringify(message), { qos: 0 });
    } catch (err) {
      console.warn('Broadcast error:', err);
    }
  }

  /**
   * 参加者画面で「AI音声を聞く」をONにしている言語だけを抽出し、
   * Gemini TTS で非同期に音声生成して MQTT 配信する
   */
  async dispatchViewerTtsForEntry(entry) {
    if (!entry || !this.interpreter?.hasApiKey?.()) return;
    if (!this.viewerAudioSubscribers || this.viewerAudioSubscribers.size === 0) return;

    const now = Date.now();
    const subscribedLangs = new Set();
    for (const [cid, sub] of this.viewerAudioSubscribers.entries()) {
      if (now - sub.updatedAt > 90000) {
        this.viewerAudioSubscribers.delete(cid);
        continue;
      }
      if (sub.lang) subscribedLangs.add(sub.lang);
    }
    if (subscribedLangs.size === 0) return;

    const sceneStyleMap = {
      sermon: 'calm, warm, and reverent tone suitable for a church sermon',
      prayer: 'gentle, humble, and reverent prayer tone',
      worship: 'clear, dignified, and welcoming church worship tone',
      announcement: 'clear, friendly, and informative announcement tone',
    };
    const style = sceneStyleMap[this.settings.sceneMode] || sceneStyleMap.sermon;
    const ttsModel = this.settings.ttsModel || 'gemini-3.8-flash-lite-tts';
    const ttsVoice = this.settings.ttsVoice || 'Kore';

    for (const lang of subscribedLangs) {
      const text =
        entry.translations?.[lang] ||
        (lang === (this.settings.sourceLang || 'ja') ? entry.sourceText || entry.ja : '');
      const cleanText = (text || '').trim();
      if (!cleanText) continue;

      this.interpreter
        .synthesizeSpeech(cleanText, { model: ttsModel, voice: ttsVoice, style })
        .then((audio) => {
          if (!audio?.data) return;
          this.broadcastToViewers({
            type: 'tts_audio',
            payload: {
              id: entry.id,
              lang,
              data: audio.data,
              mimeType: audio.mimeType || 'audio/wav',
            },
          });
        })
        .catch((err) => {
          console.warn(`Viewer TTS (${lang}) failed:`, err?.message || err);
        });
    }
  }

  renderQRCodeInto(qrBox, url) {
    qrBox.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = 140;
    canvas.height = 140;
    qrBox.appendChild(canvas);

    let rendered = false;
    if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
      try {
        QRCode.toCanvas(canvas, url, { width: 140, margin: 1 }, (err) => {
          if (!err) rendered = true;
        });
      } catch (e) {
        console.warn('Canvas QR render error:', e);
      }
    }

    // 予備フォールバック: 万一Canvas描画が失敗した場合はQR画像APIで確実に表示
    if (!rendered) {
      const img = document.createElement('img');
      img.width = 140;
      img.height = 140;
      img.alt = 'QR Code';
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=2&data=${encodeURIComponent(url)}`;
      img.onerror = () => {
        img.src = `https://quickchart.io/qr?size=140&text=${encodeURIComponent(url)}`;
      };
      qrBox.innerHTML = '';
      qrBox.appendChild(img);
    }
  }

  populateBuildingAndRoomSelects() {
    if (!this.buildingSelect || !this.roomSelect) return;
    this.buildingSelect.innerHTML = '';
    for (const b of HIROSHIMA_BUILDINGS) {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.nameJa;
      this.buildingSelect.appendChild(opt);
    }

    const matched = findBuildingAndRoom(this.settings.roomId);
    const buildingId = matched?.building?.id || this.settings.buildingId || 'hakushima';
    const roomSlotId = matched?.room?.id || this.settings.roomSlotId || 'chapel';
    this.settings.buildingId = buildingId;
    this.settings.roomSlotId = roomSlotId;
    this.buildingSelect.value = buildingId;
    this.populateRoomSelect(buildingId, roomSlotId);
  }

  populateRoomSelect(buildingId, selectedRoomId) {
    if (!this.roomSelect) return;
    const building = HIROSHIMA_BUILDINGS.find((b) => b.id === buildingId) || HIROSHIMA_BUILDINGS[0];
    this.roomSelect.innerHTML = '';
    for (const r of building.rooms) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.nameJa;
      this.roomSelect.appendChild(opt);
    }
    const exists = building.rooms.some((r) => r.id === selectedRoomId);
    this.roomSelect.value = exists ? selectedRoomId : building.rooms[0]?.id || 'chapel';
  }

  getCurrentLocationMeta() {
    const matched = findBuildingAndRoom(this.getRoomId());
    if (matched) {
      return {
        buildingId: matched.building.id,
        roomSlotId: matched.room.id,
        buildingNameJa: matched.building.nameJa,
        buildingNameEn: matched.building.nameEn,
        roomNameJa: matched.room.nameJa,
        roomNameEn: matched.room.nameEn,
      };
    }
    return {
      buildingId: this.settings.buildingId || 'custom',
      roomSlotId: this.settings.roomSlotId || 'custom',
      buildingNameJa: this.settings.churchName || 'カスタム会場',
      buildingNameEn: this.settings.churchName || 'Custom Venue',
      roomNameJa: this.getRoomId(),
      roomNameEn: this.getRoomId(),
    };
  }

  printQrPoster() {
    const roomId = this.getRoomId();
    const loc = this.getCurrentLocationMeta();
    const baseUrl =
      window.location.origin +
      window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '') +
      '/viewer.html';
    const viewerUrl = `${baseUrl}?room=${encodeURIComponent(roomId)}`;
    const qrSrc = `https://quickchart.io/qr?size=280&text=${encodeURIComponent(viewerUrl)}`;

    const win = window.open('', '_blank', 'width=760,height=920');
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>${loc.buildingNameJa} — ${loc.roomNameJa} QRポスター</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif; color: #172b4d; text-align: center; padding: 36px 24px; margin: 0; }
    .poster { max-width: 560px; margin: 0 auto; border: 2px solid #0c66e4; border-radius: 14px; padding: 32px 24px; }
    .tag { display: inline-block; background: #e9f2ff; color: #0c66e4; font-weight: 700; font-size: 13px; padding: 4px 12px; border-radius: 999px; margin-bottom: 12px; }
    h1 { font-size: 28px; margin: 4px 0 6px; }
    h2 { font-size: 20px; color: #44546f; margin: 0 0 20px; font-weight: 600; }
    .qr { margin: 16px auto; width: 260px; height: 260px; }
    .langs { text-align: left; background: #f7f8f9; border-radius: 8px; padding: 14px 18px; margin-top: 18px; font-size: 14px; line-height: 1.7; }
    .url { font-size: 12px; color: #626f86; word-break: break-all; margin-top: 14px; }
    @media print { .no-print { display: none; } body { padding: 0; } .poster { border: 2px solid #0c66e4; } }
  </style>
</head>
<body>
  <div class="poster">
    <div class="tag">LDS Interpret — Live Subtitles &amp; AI Voice</div>
    <h1>${loc.buildingNameJa}（${loc.roomNameJa}）</h1>
    <h2>${loc.buildingNameEn} — ${loc.roomNameEn}</h2>
    <img class="qr" src="${qrSrc}" alt="QR Code" />
    <div class="langs">
      <div>🇺🇸 <strong>English:</strong> Scan the QR code for live subtitles &amp; AI voice.</div>
      <div>🇵🇭 <strong>Tagalog:</strong> I-scan ang QR code para sa live na subtitle at AI voice.</div>
      <div>🇮🇩 <strong>Bahasa Indonesia:</strong> Pindai kode QR untuk terjemahan langsung &amp; suara AI.</div>
      <div>🇯🇵 <strong>日本語:</strong> QRコードを読み取るとスマホで字幕・音声を確認できます。</div>
    </div>
    <div class="url">${viewerUrl}</div>
    <button class="no-print" onclick="window.print()" style="margin-top:20px;padding:10px 20px;font-size:15px;font-weight:600;background:#0c66e4;color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨️ 印刷する</button>
  </div>
</body>
</html>`);
    win.document.close();
  }

  openShareDialog() {
    const roomId = this.getRoomId();
    const loc = this.getCurrentLocationMeta();
    if (this.shareBuildingRoomLabel) {
      this.shareBuildingRoomLabel.textContent = `🏢 ${loc.buildingNameJa} — ${loc.roomNameJa}`;
    }
    if (this.shareRoomIdLabel) {
      this.shareRoomIdLabel.textContent = roomId;
    }
    this.updateConnectedPeersCount();

    if (this.shareCardsContainer) {
      this.shareCardsContainer.innerHTML = '';

      const targetCodes = this.settings.targetLangs && this.settings.targetLangs.length > 0
        ? this.settings.targetLangs
        : ['en'];

      const baseUrl = window.location.origin + window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '') + '/viewer.html';

      // 1. 各選択言語ごとのカード
      for (const code of targetCodes) {
        const info = SUPPORTED_LANGUAGES[code] || SUPPORTED_LANGUAGES.en;
        const viewerUrl = `${baseUrl}?room=${encodeURIComponent(roomId)}&lang=${code}`;

        const card = document.createElement('div');
        card.className = 'share-card';

        const header = document.createElement('div');
        header.className = 'share-card-header';
        header.textContent = `${info.flag} ${info.nameJa} リアルタイム字幕`;
        card.appendChild(header);

        const qrBox = document.createElement('div');
        qrBox.className = 'share-qr-box';
        this.renderQRCodeInto(qrBox, viewerUrl);
        card.appendChild(qrBox);

        const actions = document.createElement('div');
        actions.className = 'share-card-actions';

        const input = document.createElement('input');
        input.type = 'text';
        input.readOnly = true;
        input.className = 'text-input share-url-input';
        input.value = viewerUrl;
        actions.appendChild(input);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-compact btn-primary';
        copyBtn.textContent = '📋 URLをコピー';
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(viewerUrl);
            const orig = copyBtn.textContent;
            copyBtn.textContent = '✅ コピー完了！';
            setTimeout(() => {
              copyBtn.textContent = orig;
            }, 1800);
          } catch {
            input.select();
            document.execCommand('copy');
            copyBtn.textContent = '✅ コピー完了！';
          }
        });
        actions.appendChild(copyBtn);

        card.appendChild(actions);
        this.shareCardsContainer.appendChild(card);
      }

      // 2. 言語切り替え可能全言語URLカード
      const allUrl = `${baseUrl}?room=${encodeURIComponent(roomId)}`;
      const allCard = document.createElement('div');
      allCard.className = 'share-card';
      allCard.style.borderColor = '#93c5fd';

      const allHeader = document.createElement('div');
      allHeader.className = 'share-card-header';
      allHeader.textContent = '🌐 全言語切り替え対応 URL';
      allCard.appendChild(allHeader);

      const allQrBox = document.createElement('div');
      allQrBox.className = 'share-qr-box';
      this.renderQRCodeInto(allQrBox, allUrl);
      allCard.appendChild(allQrBox);

      const allActions = document.createElement('div');
      allActions.className = 'share-card-actions';

      const allInput = document.createElement('input');
      allInput.type = 'text';
      allInput.readOnly = true;
      allInput.className = 'text-input share-url-input';
      allInput.value = allUrl;
      allActions.appendChild(allInput);

      const allCopyBtn = document.createElement('button');
      allCopyBtn.type = 'button';
      allCopyBtn.className = 'btn btn-compact btn-outline';
      allCopyBtn.textContent = '📋 共通URLをコピー';
      allCopyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(allUrl);
          allCopyBtn.textContent = '✅ コピー完了！';
          setTimeout(() => {
            allCopyBtn.textContent = '📋 共通URLをコピー';
          }, 1800);
        } catch {}
      });
      allActions.appendChild(allCopyBtn);

      allCard.appendChild(allActions);
      this.shareCardsContainer.appendChild(allCard);
    }

    this.shareDialog.showModal();
  }

  getTargetCommittedText(langCode = null) {
    if (langCode) {
      const panel = document.getElementById(`langPanelBody_${langCode}`);
      if (panel) return panel.textContent.trim();
    }
    if (this.currentViewTargetLang && this.currentViewTargetLang !== 'all') {
      const panel = document.getElementById(`langPanelBody_${this.currentViewTargetLang}`);
      if (panel) return panel.textContent.trim();
    }
    const targetCodes = this.settings.targetLangs || ['en'];
    if (targetCodes.length === 1) {
      const panel = document.getElementById(`langPanelBody_${targetCodes[0]}`);
      if (panel) return panel.textContent.trim();
    }
    const parts = [];
    for (const code of targetCodes) {
      const info = SUPPORTED_LANGUAGES[code] || { nameJa: code, nameEn: code, flag: '' };
      const panel = document.getElementById(`langPanelBody_${code}`);
      const txt = panel ? panel.textContent.trim() : '';
      if (txt) {
        parts.push(`【${info.flag} ${info.nameJa} (${info.nameEn})】\n${txt}`);
      }
    }
    if (parts.length > 0) return parts.join('\n\n');
    return this.enCommittedContainer ? this.enCommittedContainer.textContent.trim() : '';
  }

  async copySingleBoxText(lang) {
    if (this.history.length === 0) {
      alert('コピーする文章がまだありません。');
      return;
    }
    const text =
      lang === 'ja'
        ? this.jaCommittedContainer.textContent.trim()
        : this.getTargetCommittedText();
    const btn = lang === 'ja' ? this.copyJaOnlyBtn : this.copyEnOnlyBtn;
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = '✅ コピー完了';
      setTimeout(() => {
        btn.textContent = orig;
      }, 1600);
    } catch {
      alert('コピーに失敗しました。');
    }
  }

  async copyAllTranscript() {
    if (this.history.length === 0) {
      alert('コピーする文章がまだありません。');
      return;
    }

    const srcInfo = this.interpreter.getSourceLangInfo();
    const jaFull = this.jaCommittedContainer.textContent.trim();
    const enFull = this.getTargetCommittedText();
    const combined = `【${srcInfo.flag} ${srcInfo.sourceBoxTitle}】\n${jaFull}\n\n【翻訳結果】\n${enFull}`;

    try {
      await navigator.clipboard.writeText(combined);
      const orig = this.copyAllLogBtn.textContent;
      this.copyAllLogBtn.textContent = '✅ 全文コピー完了';
      setTimeout(() => {
        this.copyAllLogBtn.textContent = orig;
      }, 1800);
    } catch {
      alert('クリップボードへのコピーに失敗しました。「📥 テキスト出力 (.txt)」をご利用ください。');
    }
  }

  /**
   * スタートから終了までの通訳結果（各言語通訳全文＋話者書き起こし全文＋修正・フィードバック再取込用セクション）を
   * テキストファイル（.txt）として出力する
   */
  exportTranscriptLog() {
    if (this.history.length === 0) {
      alert('出力する通訳結果がまだありません。通訳を実行してからお試しください。');
      return;
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const jaFull = this.jaCommittedContainer.textContent.trim();
    const targetCodes = this.settings.targetLangs || ['en'];

    const validEntries = this.history.filter((h) => !h.isParagraphBreak && (h.sourceText || h.ja));
    const firstTime = validEntries[0]?.time || '';
    const lastTime = validEntries[validEntries.length - 1]?.time || '';

    const srcCode = this.settings.sourceLang || 'ja';
    const pairLines = validEntries.map((entry, idx) => {
      const srcText = entry.sourceText || entry.ja || '';
      const lines = [
        `[SEGMENT #${idx + 1}] (${entry.time || ''})`,
        `SOURCE (${srcCode.toUpperCase()}): ${srcText.trim()}`,
      ];
      for (const tCode of targetCodes) {
        const tInfo = SUPPORTED_LANGUAGES[tCode] || { nameJa: tCode };
        const transText = entry.translations?.[tCode] || (tCode === 'en' ? entry.en : '') || '';
        lines.push(`${tCode.toUpperCase()} (${tInfo.nameJa}): ${transText.trim()}`);
      }
      lines.push('');
      return lines.join('\n');
    });

    const srcInfo = this.interpreter.getSourceLangInfo();
    const tgtNames = targetCodes
      .map((c) => {
        const info = SUPPORTED_LANGUAGES[c];
        return info ? `${info.flag} ${info.nameJa}` : c;
      })
      .join(', ');

    const targetSections = targetCodes.map((code, i) => {
      const info = SUPPORTED_LANGUAGES[code] || { nameJa: code, nameEn: code, flag: '' };
      const panel = document.getElementById(`langPanelBody_${code}`);
      const txt = panel ? panel.textContent.trim() : (code === 'en' ? this.enCommittedContainer?.textContent?.trim() : '');
      return `【1-${i + 1}. ${info.flag} ${info.nameJa} (${info.nameEn}) 全文】\n${txt || '（なし）'}\n`;
    }).join('\n');

    const lines = [
      `# 通訳結果テキストファイル (${dateStr} ${firstTime} - ${lastTime})`,
      `# 通訳言語: ${srcInfo.flag} ${srcInfo.nameJa} ➔ ${tgtNames}`,
      this.settings.churchName ? `# 教会名: ${this.settings.churchName}` : null,
      '====================================================================',
      '',
      targetSections,
      '====================================================================',
      '',
      `【2. ${srcInfo.sourceBoxTitle} 全文（スタートから終了まで）】`,
      jaFull,
      '',
      '====================================================================',
      '【3. 通訳修正・フィードバック取り込み用セクション】',
      '※ 下の [FEEDBACK] に通訳への改善要望を書くか、各 [SEGMENT] の訳文を修正して保存し、',
      '   アプリの「結果の修正・フィードバック学習」->「修正したテキストファイル(.txt)を取り込んで学習」',
      '   から読み込ませると、辞書登録や今後の通訳改善ルールに自動反映されます。',
      '--------------------------------------------------------------------',
      '[FEEDBACK]',
      '# （ここにフィードバックを自由記述できます。例：「兄弟姉妹」は Brothers and sisters in Christ と訳す）',
      '',
      '[SEGMENTS]',
      ...pairLines,
    ].filter((l) => l !== null);

    // Macの「テキストエディット」やWindowsの「メモ帳」で文字化け・Shift_JIS誤判定が起きないよう UTF-8 BOM (\uFEFF) を付与
    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interpretation-result-${dateStr}-${timeStr}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ==========================================================================
     Feedback & Translation Correction Learning System
     ========================================================================== */
  openFeedbackDialog() {
    this.feedbackStatusMessage.hidden = true;
    this.renderEditableSegmentsList();
    this.renderLearnedMemoryList();
    this.feedbackDialog.showModal();
  }

  showFeedbackStatus(message, isError = false) {
    this.feedbackStatusMessage.hidden = false;
    this.feedbackStatusMessage.classList.toggle('is-error', isError);
    this.feedbackStatusMessage.textContent = message;
  }

  renderEditableSegmentsList() {
    this.editableSegmentsContainer.innerHTML = '';
    const validEntries = this.history.filter((h) => !h.isParagraphBreak && h.ja);

    if (validEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'field-hint';
      empty.textContent =
        '※ 現在表示中の通訳履歴がありません。通訳を行ったあとに開くと、ここで各文の英語訳を直接手直しして学習させることができます。';
      this.editableSegmentsContainer.appendChild(empty);
      this.applyEditedSegmentsBtn.disabled = true;
      return;
    }

    this.applyEditedSegmentsBtn.disabled = false;

    for (const entry of validEntries) {
      const item = document.createElement('div');
      item.className = 'editable-seg-item';
      item.innerHTML = `
        <div class="editable-seg-ja">🇯🇵 ${this.escapeHtml(entry.ja)}</div>
        <input
          type="text"
          class="text-input editable-seg-en-input"
          data-entry-id="${this.escapeHtml(entry.id)}"
          value="${this.escapeHtml(entry.en || '')}"
          aria-label="英語通訳の修正"
        />
      `;
      this.editableSegmentsContainer.appendChild(item);
    }
  }

  renderLearnedMemoryList() {
    this.learnedRulesListContainer.innerHTML = '';

    const hasRules = this.feedbackRules.length > 0;
    const hasCorrections = this.correctionExamples.length > 0;

    if (!hasRules && !hasCorrections) {
      const empty = document.createElement('div');
      empty.className = 'field-hint';
      empty.textContent = 'まだ学習された通訳ルールや修正お手本はありません。';
      this.learnedRulesListContainer.appendChild(empty);
      return;
    }

    // 1. フィードバックルール一覧
    for (const rule of this.feedbackRules) {
      const row = document.createElement('div');
      row.className = 'memory-item';
      row.innerHTML = `
        <div class="memory-item-text">
          <span class="memory-tag">通訳指示</span>
          <span>${this.escapeHtml(rule.text)}</span>
        </div>
        <button type="button" class="btn btn-compact btn-ghost delete-rule-btn" title="このルールを削除">🗑</button>
      `;
      row.querySelector('.delete-rule-btn').addEventListener('click', () => {
        this.feedbackRules = this.feedbackRules.filter((r) => r.id !== rule.id);
        this.saveFeedbackRules();
        this.renderLearnedMemoryList();
      });
      this.learnedRulesListContainer.appendChild(row);
    }

    // 2. 修正お手本ペア一覧
    for (const corr of this.correctionExamples) {
      const row = document.createElement('div');
      row.className = 'memory-item';
      row.innerHTML = `
        <div class="memory-item-text">
          <span class="memory-tag">修正お手本</span>
          <span><strong>${this.escapeHtml(corr.ja)}</strong> ➔ ${this.escapeHtml(corr.afterEn)}</span>
        </div>
        <button type="button" class="btn btn-compact btn-ghost delete-corr-btn" title="このお手本を削除">🗑</button>
      `;
      row.querySelector('.delete-corr-btn').addEventListener('click', () => {
        this.correctionExamples = this.correctionExamples.filter((c) => c.id !== corr.id);
        this.saveCorrectionExamples();
        this.renderLearnedMemoryList();
      });
      this.learnedRulesListContainer.appendChild(row);
    }
  }

  /**
   * テキスト入力されたフィードバックを解析し、用語集と今後の通訳ルールに反映する
   */
  async applyFeedbackText() {
    const rawFeedback = this.sessionFeedbackTextarea.value.trim();
    if (!rawFeedback) {
      this.showFeedbackStatus('⚠️ フィードバック内容を入力してください。', true);
      return;
    }

    this.applyFeedbackTextBtn.disabled = true;
    this.showFeedbackStatus('🔄 フィードバックを解析し、用語集と通訳改善ルールへ学習させています...');

    try {
      const stats = await this.learnFromFeedbackAndCorrections({
        feedbackText: rawFeedback,
        modifiedPairs: [],
      });
      this.sessionFeedbackTextarea.value = '';
      this.showFeedbackStatus(
        `✅ フィードバックを学習しました！（通訳改善ルール +${stats.addedRules}件 / 辞書登録・更新 +${stats.addedTerms}語） 今後の通訳から自動的に反映されます。`
      );
    } catch (err) {
      this.showFeedbackStatus(`❌ エラーが発生しました: ${err?.message || '解析失敗'}`, true);
    } finally {
      this.applyFeedbackTextBtn.disabled = false;
    }
  }

  /**
   * ダイアログ上で直接書き換えられた英語訳を検出し、画面更新＋辞書・通訳改善学習を行う
   */
  async applyEditedSegments() {
    const inputs = this.editableSegmentsContainer.querySelectorAll('input[data-entry-id]');
    const modifiedPairs = [];

    for (const input of inputs) {
      const entryId = input.getAttribute('data-entry-id');
      const newEn = input.value.trim();
      const entry = this.history.find((h) => h.id === entryId);
      if (entry && newEn && newEn !== (entry.en || '').trim()) {
        modifiedPairs.push({
          ja: entry.ja,
          beforeEn: entry.en || '',
          afterEn: newEn,
        });
        entry.en = newEn;
      }
    }

    if (modifiedPairs.length === 0) {
      this.showFeedbackStatus('⚠️ 変更された英語訳がありません。英文を書き換えてから押してください。', true);
      return;
    }

    this.applyEditedSegmentsBtn.disabled = true;
    this.showFeedbackStatus('🔄 修正された通訳内容を解析し、辞書登録と通訳ルールを学習中...');

    try {
      this.saveHistory();
      this.rebuildContinuousBoxesFromHistory();

      const stats = await this.learnFromFeedbackAndCorrections({
        feedbackText: '',
        modifiedPairs,
      });

      this.showFeedbackStatus(
        `✅ ${modifiedPairs.length}箇所の通訳修正を画面に反映し、学習しました！（修正お手本 +${stats.addedCorrections}件 / 辞書登録・更新 +${stats.addedTerms}語 / 通訳ルール +${stats.addedRules}件）`
      );
    } catch (err) {
      this.showFeedbackStatus(`❌ 学習中にエラーが発生しました: ${err?.message || ''}`, true);
    } finally {
      this.applyEditedSegmentsBtn.disabled = false;
    }
  }

  /**
   * 外部テキストエディタ等で修正された通訳結果テキストファイル (.txt) を読み込み、
   * 変更された英文や記入されたフィードバックを抽出して学習・辞書登録する
   */
  async importEditedTxtFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';

    this.showFeedbackStatus(`🔄 「${file.name}」から修正内容とフィードバックを読み込み中...`);

    try {
      const content = await file.text();
      const { feedbackLines, parsedSegments } = this.parseExportedTxtContent(content);

      const modifiedPairs = [];
      const validHistory = this.history.filter((h) => !h.isParagraphBreak && h.ja);

      for (const seg of parsedSegments) {
        const cleanSegJa = seg.ja.replace(/[。！？\s]/g, '');
        const matchingEntry = validHistory.find(
          (h) => h.ja.replace(/[。！？\s]/g, '') === cleanSegJa
        );

        if (matchingEntry) {
          if (seg.en && seg.en !== (matchingEntry.en || '').trim()) {
            modifiedPairs.push({
              ja: matchingEntry.ja,
              beforeEn: matchingEntry.en || '',
              afterEn: seg.en,
            });
            matchingEntry.en = seg.en;
          }
        } else if (seg.ja && seg.en) {
          // 履歴外の新規または別セッションの修正ペアも学習対象として取り込む
          modifiedPairs.push({
            ja: seg.ja,
            beforeEn: '',
            afterEn: seg.en,
          });
        }
      }

      const combinedFeedback = feedbackLines.join('\n').trim();

      if (!combinedFeedback && modifiedPairs.length === 0) {
        this.showFeedbackStatus(
          '⚠️ ファイル内に変更された英語訳（EN: 行）または [FEEDBACK] の記述が見つかりませんでした。',
          true
        );
        return;
      }

      if (modifiedPairs.length > 0 && validHistory.length > 0) {
        this.saveHistory();
        this.rebuildContinuousBoxesFromHistory();
        this.renderEditableSegmentsList();
      }

      const stats = await this.learnFromFeedbackAndCorrections({
        feedbackText: combinedFeedback,
        modifiedPairs,
      });

      this.showFeedbackStatus(
        `✅ テキストファイルを取り込み、学習を完了しました！（修正お手本 +${stats.addedCorrections}件 / 辞書登録・更新 +${stats.addedTerms}語 / 通訳改善ルール +${stats.addedRules}件）`
      );
    } catch (err) {
      this.showFeedbackStatus(
        `❌ ファイルの取り込みに失敗しました: ${err?.message || 'フォーマットをご確認ください'}`,
        true
      );
    }
  }

  /**
   * 出力した .txt ファイルから [FEEDBACK] と JA:/EN: セグメントを抽出するパーサー
   */
  parseExportedTxtContent(text) {
    const cleanText = String(text || '').replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/);
    const feedbackLines = [];
    const parsedSegments = [];

    let section = '';
    let currentJa = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line === '[FEEDBACK]') {
        section = 'feedback';
        continue;
      }
      if (line === '[SEGMENTS]' || line.startsWith('[SEGMENT #')) {
        section = 'segments';
        continue;
      }
      if (line.startsWith('===') || line.startsWith('---') || line.startsWith('【')) {
        if (section === 'feedback') section = '';
        continue;
      }

      if (section === 'feedback') {
        if (!line.startsWith('#') && !line.startsWith('※')) {
          feedbackLines.push(line);
        }
      } else if (line.startsWith('JA:')) {
        currentJa = line.slice(3).trim();
      } else if (line.startsWith('EN:') && currentJa) {
        const currentEn = line.slice(3).trim();
        parsedSegments.push({ ja: currentJa, en: currentEn });
        currentJa = '';
      }
    }

    return { feedbackLines, parsedSegments };
  }

  /**
   * フィードバック文と修正ペアから、
   * 1) 修正お手本メモリ (correctionExamples) の保存
   * 2) AI / 正規表現による用語抽出と教会用語集 (glossary) への自動登録・更新
   * 3) 通訳改善ルール (feedbackRules) への登録
   * を一括実行する
   */
  async learnFromFeedbackAndCorrections({ feedbackText = '', modifiedPairs = [] }) {
    let addedCorrections = 0;
    let addedTerms = 0;
    let addedRules = 0;

    // 1. 修正ペアをお手本メモリに保存
    for (const pair of modifiedPairs) {
      if (!pair.ja || !pair.afterEn) continue;
      const existingIdx = this.correctionExamples.findIndex(
        (c) => c.ja.replace(/[。！？\s]/g, '') === pair.ja.replace(/[。！？\s]/g, '')
      );
      if (existingIdx !== -1) {
        this.correctionExamples[existingIdx].afterEn = pair.afterEn;
      } else {
        this.correctionExamples.unshift({
          id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ja: pair.ja,
          beforeEn: pair.beforeEn || '',
          afterEn: pair.afterEn,
          enabled: true,
        });
      }
      addedCorrections++;
    }

    // 2. Gemini / ローカル解析で辞書登録すべき用語と通訳改善ルールを抽出
    const analysis = await this.interpreter.analyzeFeedbackAndCorrections({
      feedbackText,
      modifiedPairs,
    });

    for (const term of analysis.terms || []) {
      if (!term.ja || !term.en) continue;
      const existingGlossaryIdx = this.glossary.findIndex((g) => g.ja === term.ja);
      if (existingGlossaryIdx !== -1) {
        this.glossary[existingGlossaryIdx].en = term.en;
        this.glossary[existingGlossaryIdx].enabled = true;
        if (term.note) {
          this.glossary[existingGlossaryIdx].note = term.note;
        }
      } else {
        this.glossary.unshift({
          id: `fb-term-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          ja: term.ja,
          en: term.en,
          category: 'custom',
          reading: '',
          variants: [],
          note: term.note || '通訳フィードバック・修正から登録',
          enabled: true,
        });
      }
      addedTerms++;
    }

    for (const ruleText of analysis.rules || []) {
      const cleanRule = ruleText.trim();
      if (!cleanRule) continue;
      const alreadyExists = this.feedbackRules.some((r) => r.text === cleanRule);
      if (!alreadyExists) {
        this.feedbackRules.unshift({
          id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: cleanRule,
          enabled: true,
        });
        addedRules++;
      }
    }

    this.saveCorrectionExamples();
    this.saveFeedbackRules();
    if (addedTerms > 0) {
      this.saveGlossary();
      this.renderGlossary();
      this.rebuildContinuousBoxesFromHistory();
    }
    this.renderLearnedMemoryList();

    return { addedCorrections, addedTerms, addedRules };
  }

  /* ==========================================================================
     Sermon Manuscript (Japanese + English) Glossary Candidate Extractor
     ========================================================================== */
  openSermonExtractDialog() {
    this.sermonExtractStatusMsg.hidden = true;
    this.sermonExtractDialog.showModal();
  }

  fillSampleSermonPair() {
    this.sermonJaManuscriptInput.value =
      '本日は恵みキリスト教会の主日礼拝へようこそお越しくださいました。ヨハネによる福音書3章16節を開きましょう。イエス・キリストの十字架の贖いによって、私たちは罪の赦しと永遠の命をいただきました。兄弟姉妹の皆さん、神の国の福音を宣教し、礼拝堂での交わりと聖餐式を通して主の恵みを証ししてまいりましょう。';
    this.sermonEnManuscriptInput.value =
      'Welcome to the Sunday Worship Service of Grace Christian Church today. Let us open the Gospel of John, chapter 3, verse 16. Through the redemption of Jesus Christ on the cross, we have received the forgiveness of sins and eternal life. Brothers and sisters in Christ, let us proclaim the Gospel of the Kingdom of God and bear witness to the grace of the Lord through fellowship in our sanctuary and Holy Communion.';
  }

  async runSermonGlossaryExtraction() {
    const jaText = this.sermonJaManuscriptInput.value.trim();
    const enText = this.sermonEnManuscriptInput.value.trim();

    if (!jaText || !enText) {
      this.sermonExtractStatusMsg.hidden = false;
      this.sermonExtractStatusMsg.classList.add('is-error');
      this.sermonExtractStatusMsg.textContent =
        '⚠️ 日本語の説教文章と、英語訳の文章の両方を入力してください。';
      return;
    }

    this.runSermonExtractBtn.disabled = true;
    this.sermonExtractStatusMsg.hidden = false;
    this.sermonExtractStatusMsg.classList.remove('is-error');
    this.sermonExtractStatusMsg.textContent =
      '🔄 日本語原稿と英語訳を比較解析し、辞書登録が必要な教会用語・表現をリストアップしています...';

    try {
      const candidates = await this.interpreter.extractGlossaryCandidatesFromSermonPair(
        jaText,
        enText,
        this.glossary
      );
      this.currentSermonCandidates = candidates;
      this.renderSermonCandidatesList();

      const newOrUpdateCount = candidates.filter((c) => c.status !== 'already_registered').length;
      this.sermonExtractStatusMsg.textContent = `✅ ${candidates.length}件の教会用語・重要表現をリストアップしました（うち新規・訳語更新候補: ${newOrUpdateCount}件）。チェックを確認して一括登録できます。`;
    } catch (err) {
      this.sermonExtractStatusMsg.classList.add('is-error');
      this.sermonExtractStatusMsg.textContent = `❌ 抽出エラー: ${err?.message || '解析に失敗しました'}`;
    } finally {
      this.runSermonExtractBtn.disabled = false;
    }
  }

  renderSermonCandidatesList() {
    this.sermonCandidatesListContainer.innerHTML = '';
    if (!this.currentSermonCandidates || this.currentSermonCandidates.length === 0) {
      this.sermonCandidatesSection.hidden = true;
      return;
    }

    this.sermonCandidatesSection.hidden = false;

    this.currentSermonCandidates.forEach((cand, idx) => {
      const badgeLabel =
        cand.status === 'new'
          ? '🆕 新規登録候補'
          : cand.status === 'update_existing'
          ? '🔄 訳語の更新候補'
          : '✓ 辞書登録済み';

      const row = document.createElement('div');
      row.className = 'editable-seg-item';
      row.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
          <label style="display: inline-flex; align-items: center; gap: 0.45rem; font-weight: 700; font-size: 0.86rem; cursor: pointer;">
            <input type="checkbox" class="cand-check" data-idx="${idx}" ${cand.selected ? 'checked' : ''} />
            <span class="memory-tag">${badgeLabel}</span>
            <span>${this.escapeHtml(cand.ja)}</span>
          </label>
          <span class="field-hint">${this.escapeHtml(cand.note || '')}</span>
        </div>
        <div class="form-row-2col" style="margin-top: 0.25rem;">
          <input
            type="text"
            class="text-input input-sm cand-ja-input"
            data-idx="${idx}"
            value="${this.escapeHtml(cand.ja)}"
            placeholder="日本語用語"
          />
          <input
            type="text"
            class="text-input input-sm cand-en-input"
            data-idx="${idx}"
            value="${this.escapeHtml(cand.en)}"
            placeholder="英語訳"
          />
        </div>
      `;
      this.sermonCandidatesListContainer.appendChild(row);
    });
  }

  registerSelectedSermonCandidates() {
    const checks = this.sermonCandidatesListContainer.querySelectorAll('.cand-check');
    let addedCount = 0;
    let updatedCount = 0;

    checks.forEach((chk) => {
      if (!chk.checked) return;
      const idx = parseInt(chk.getAttribute('data-idx'), 10);
      const baseCand = this.currentSermonCandidates[idx];
      if (!baseCand) return;

      const jaInput = this.sermonCandidatesListContainer.querySelector(`.cand-ja-input[data-idx="${idx}"]`);
      const enInput = this.sermonCandidatesListContainer.querySelector(`.cand-en-input[data-idx="${idx}"]`);

      const ja = (jaInput?.value || baseCand.ja).trim();
      const en = (enInput?.value || baseCand.en).trim();
      if (!ja || !en) return;

      const existingIdx = this.glossary.findIndex((g) => g.ja === ja);
      if (existingIdx !== -1) {
        this.glossary[existingIdx].en = en;
        this.glossary[existingIdx].enabled = true;
        if (baseCand.note) this.glossary[existingIdx].note = baseCand.note;
        updatedCount++;
      } else {
        this.glossary.unshift({
          id: `sermon-${Date.now()}-${idx}`,
          ja,
          en,
          category: baseCand.category || 'custom',
          reading: baseCand.reading || '',
          variants: baseCand.variants || [],
          note: baseCand.note || '説教対訳原稿から登録',
          enabled: true,
        });
        addedCount++;
      }
    });

    if (addedCount === 0 && updatedCount === 0) {
      alert('登録する用語にチェックを入れてください。');
      return;
    }

    this.saveGlossary();
    this.renderGlossary();
    this.rebuildContinuousBoxesFromHistory();

    this.sermonExtractStatusMsg.hidden = false;
    this.sermonExtractStatusMsg.classList.remove('is-error');
    this.sermonExtractStatusMsg.textContent = `✅ 教会用語集（辞書）へ 新規 ${addedCount}語・更新 ${updatedCount}語 を登録しました！`;
  }

  /* ==========================================================================
     Church Glossary Management (CRUD + Search + CSV Import/Export)
     ========================================================================== */
  renderGlossary() {
    this.glossaryListContainer.innerHTML = '';

    const filtered = this.glossary.filter((item) => {
      if (this.selectedCategory !== 'all' && item.category !== this.selectedCategory) {
        return false;
      }
      if (!this.searchQuery) return true;
      const haystack = `${item.ja} ${item.en} ${item.reading || ''} ${item.note || ''} ${(item.variants || []).join(' ')}`.toLowerCase();
      return haystack.includes(this.searchQuery);
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '1.5rem';
      empty.style.color = '#8b9bb4';
      empty.textContent = '該当する教会用語が見つかりません。「＋ 用語追加」から登録できます。';
      this.glossaryListContainer.appendChild(empty);
      return;
    }

    for (const item of filtered) {
      const catInfo = GLOSSARY_CATEGORIES[item.category] || GLOSSARY_CATEGORIES.custom;
      const row = document.createElement('div');
      row.className = `glossary-item ${item.enabled ? '' : 'is-disabled'}`.trim();

      const variantsInfo =
        item.variants && item.variants.length > 0
          ? `<span>誤変換対策: ${this.escapeHtml(item.variants.join(', '))}</span>`
          : '';

      row.innerHTML = `
        <div class="glossary-item-main">
          <div class="glossary-item-title-row">
            <span class="glossary-ja">${this.escapeHtml(item.ja)}</span>
            <span class="glossary-arrow">➔</span>
            <span class="glossary-en">${this.escapeHtml(item.en)}</span>
          </div>
          <div class="glossary-meta">
            <span class="cat-tag">${this.escapeHtml(catInfo.label)}</span>
            ${item.note ? `<span>${this.escapeHtml(item.note)}</span>` : ''}
            ${variantsInfo}
          </div>
        </div>
        <div class="glossary-item-actions">
          <input
            type="checkbox"
            class="term-toggle"
            ${item.enabled ? 'checked' : ''}
            title="この用語を通訳時に有効にする"
            aria-label="${this.escapeHtml(item.ja)} を有効化"
          />
          <button type="button" class="btn btn-compact btn-ghost edit-term-btn" title="編集" aria-label="${this.escapeHtml(item.ja)} を編集">✎</button>
          <button type="button" class="btn btn-compact btn-ghost delete-term-btn" title="削除" aria-label="${this.escapeHtml(item.ja)} を削除">🗑</button>
        </div>
      `;

      row.querySelector('.term-toggle').addEventListener('change', (e) => {
        item.enabled = e.target.checked;
        row.classList.toggle('is-disabled', !item.enabled);
        this.saveGlossary();
      });

      row.querySelector('.edit-term-btn').addEventListener('click', () => {
        this.openTermDialog(item);
      });

      row.querySelector('.delete-term-btn').addEventListener('click', () => {
        this.glossary = this.glossary.filter((g) => g.id !== item.id);
        this.saveGlossary();
        this.renderGlossary();
        this.rebuildContinuousBoxesFromHistory();
      });

      this.glossaryListContainer.appendChild(row);
    }
  }

  openTermDialog(existingTerm = null) {
    if (existingTerm) {
      this.termDialogTitle.textContent = '教会用語の編集';
      this.termIdInput.value = existingTerm.id;
      this.termJaInput.value = existingTerm.ja;
      this.termEnInput.value = existingTerm.en;
      this.termCategorySelect.value = existingTerm.category || 'custom';
      this.termReadingInput.value = existingTerm.reading || '';
      this.termVariantsInput.value = (existingTerm.variants || []).join(', ');
      this.termNoteInput.value = existingTerm.note || '';
    } else {
      this.termDialogTitle.textContent = '新しい教会用語を登録';
      this.termIdInput.value = '';
      this.termJaInput.value = '';
      this.termEnInput.value = '';
      this.termCategorySelect.value = 'custom';
      this.termReadingInput.value = '';
      this.termVariantsInput.value = '';
      this.termNoteInput.value = '';
    }

    this.termDialog.showModal();
  }

  saveTermFromDialog() {
    const id = this.termIdInput.value.trim();
    const ja = this.termJaInput.value.trim();
    const en = this.termEnInput.value.trim();
    if (!ja || !en) return;

    const category = this.termCategorySelect.value || 'custom';
    const reading = this.termReadingInput.value.trim();
    const variants = this.termVariantsInput.value
      .split(/[,、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const note = this.termNoteInput.value.trim();

    if (id) {
      const idx = this.glossary.findIndex((g) => g.id === id);
      if (idx !== -1) {
        this.glossary[idx] = {
          ...this.glossary[idx],
          ja,
          en,
          category,
          reading,
          variants,
          note,
        };
      }
    } else {
      this.glossary.unshift({
        id: `c-${Date.now()}`,
        ja,
        en,
        category,
        reading,
        variants,
        note,
        enabled: true,
      });
    }

    this.saveGlossary();
    this.renderGlossary();
    this.rebuildContinuousBoxesFromHistory();
    this.termDialog.close();
  }

  openSettingsDialog() {
    this.apiKeyInput.value = this.settings.apiKey || '';
    this.geminiModelSelect.value = this.settings.model || 'gemini-3.5-flash-lite';
    if (this.ttsModelSelect) {
      this.ttsModelSelect.value = this.settings.ttsModel || 'gemini-3.8-flash-lite-tts';
    }
    if (this.ttsVoiceSelect) {
      this.ttsVoiceSelect.value = this.settings.ttsVoice || 'Kore';
    }
    this.audioInputModeSelect.value = this.settings.audioInputMode || 'webspeech-gemini';
    this.churchNameInput.value = this.settings.churchName || '';
    this.autoCommitLengthInput.value = String(this.settings.autoCommitLength || 42);
    if (this.githubRepoInput) {
      this.githubRepoInput.value = this.settings.githubRepo || 'kmats1014/lds-interpret';
    }
    if (this.githubTokenInput) {
      this.githubTokenInput.value = this.settings.githubToken || '';
    }
    this.apiTestResultBox.textContent = '';
    this.settingsDialog.showModal();
  }

  encodeBase64Utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  }

  decodeBase64Utf8(b64) {
    const clean = b64.replace(/\s+/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  async backupGlossaryToGithub() {
    const repo = (this.settings.githubRepo || 'kmats1014/lds-interpret').trim();
    const token = (this.settings.githubToken || '').trim();
    if (!token) {
      const goSetting = window.confirm(
        'GitHub に辞書を保存するには、Personal Access Token（トークン）の設定が必要です。\n「⚙ API・環境設定」画面を開いて設定しますか？'
      );
      if (goSetting) {
        this.openSettingsDialog();
        setTimeout(() => this.githubTokenInput?.focus(), 100);
      }
      return;
    }

    const filePath = 'glossary-backup.json';
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const btn = this.backupGlossaryGithubBtn;
    const origLabel = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '☁️ 保存中...';
    }

    try {
      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
      };

      // 既存ファイルの sha を確認
      let existingSha = undefined;
      const getRes = await fetch(`${apiUrl}?t=${Date.now()}`, { headers });
      if (getRes.ok) {
        const existingData = await getRes.json();
        existingSha = existingData.sha;
      } else if (getRes.status !== 404) {
        const errBody = await getRes.json().catch(() => ({}));
        throw new Error(errBody.message || `HTTP ${getRes.status}`);
      }

      const payloadObj = {
        version: 1,
        updatedAt: new Date().toISOString(),
        count: this.glossary.length,
        terms: this.glossary,
      };
      const contentB64 = this.encodeBase64Utf8(JSON.stringify(payloadObj, null, 2));

      const putBody = {
        message: `Backup church glossary (${this.glossary.length} terms)`,
        content: contentB64,
        ...(existingSha ? { sha: existingSha } : {}),
      };

      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(putBody),
      });

      if (!putRes.ok) {
        const errBody = await putRes.json().catch(() => ({}));
        throw new Error(errBody.message || `HTTP ${putRes.status}`);
      }

      window.alert(`✅ GitHub (${repo}) の ${filePath} に ${this.glossary.length} 語の辞書をバックアップしました！`);
    } catch (err) {
      window.alert(`❌ GitHub への保存に失敗しました:\n${err?.message || err}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = origLabel;
      }
    }
  }

  async restoreGlossaryFromGithub() {
    const repo = (this.settings.githubRepo || 'kmats1014/lds-interpret').trim();
    const token = (this.settings.githubToken || '').trim();
    const filePath = 'glossary-backup.json';
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}?t=${Date.now()}`;
    const btn = this.restoreGlossaryGithubBtn;
    const origLabel = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '☁️ 取得中...';
    }

    try {
      const headers = { Accept: 'application/vnd.github+json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(apiUrl, { headers });
      if (res.status === 404) {
        window.alert(
          `GitHub (${repo}) にまだバックアップファイル（${filePath}）がありません。\n先に辞書を登録した状態で「☁️ GitHub保存」を実行してください。`
        );
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `HTTP ${res.status}`);
      }

      const fileData = await res.json();
      const rawJson = this.decodeBase64Utf8(fileData.content || '');
      const parsed = JSON.parse(rawJson);
      const terms = Array.isArray(parsed) ? parsed : Array.isArray(parsed.terms) ? parsed.terms : null;
      if (!terms) {
        throw new Error('バックアップデータの形式が正しくありません。');
      }

      const updatedStr = parsed.updatedAt ? new Date(parsed.updatedAt).toLocaleString('ja-JP') : '不明';
      const ok = window.confirm(
        `GitHub バックアップ（${terms.length} 語 / 更新: ${updatedStr}）が見つかりました。\n現在の辞書と統合（マージ）して復元しますか？\n（※同じ日本語の用語はバックアップの内容で更新され、現在の独自の用語は残ります）`
      );
      if (!ok) return;

      const byJa = new Map(this.glossary.map((g) => [g.ja, g]));
      let added = 0;
      let updated = 0;
      for (const item of terms) {
        if (!item || !item.ja || !item.en) continue;
        if (byJa.has(item.ja)) {
          Object.assign(byJa.get(item.ja), item);
          updated++;
        } else {
          this.glossary.push(item);
          byJa.set(item.ja, item);
          added++;
        }
      }

      this.saveGlossary();
      this.renderGlossary();
      window.alert(`✅ GitHub から辞書を復元しました！（新規追加: ${added} 語 / 更新: ${updated} 語 / 合計: ${this.glossary.length} 語）`);
    } catch (err) {
      window.alert(`❌ GitHub からの復元に失敗しました:\n${err?.message || err}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = origLabel;
      }
    }
  }

  exportGlossaryCsv() {
    const header = ['ja', 'en', 'category', 'reading', 'variants', 'note', 'enabled'];
    const csvRows = [header.join(',')];

    for (const g of this.glossary) {
      const row = [
        this.csvEscape(g.ja),
        this.csvEscape(g.en),
        this.csvEscape(g.category || 'custom'),
        this.csvEscape(g.reading || ''),
        this.csvEscape((g.variants || []).join('|')),
        this.csvEscape(g.note || ''),
        g.enabled ? 'true' : 'false',
      ];
      csvRows.push(row.join(','));
    }

    const bom = '\uFEFF';
    const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'church-glossary.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async importGlossaryFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          this.mergeImportedTerms(parsed);
        }
      } else {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const imported = [];
        for (let i = 0; i < lines.length; i++) {
          const cols = this.parseCsvLine(lines[i]);
          if (i === 0 && (cols[0] === 'ja' || cols[0] === '日本語')) continue;
          if (cols.length >= 2 && cols[0] && cols[1]) {
            imported.push({
              ja: cols[0].trim(),
              en: cols[1].trim(),
              category: cols[2]?.trim() || 'custom',
              reading: cols[3]?.trim() || '',
              variants: cols[4] ? cols[4].split('|').map((s) => s.trim()).filter(Boolean) : [],
              note: cols[5]?.trim() || '',
              enabled: cols[6] ? cols[6].trim().toLowerCase() !== 'false' : true,
            });
          }
        }
        this.mergeImportedTerms(imported);
      }
    } catch (err) {
      alert(`ファイルの読み込みに失敗しました: ${err.message}`);
    } finally {
      event.target.value = '';
    }
  }

  mergeImportedTerms(newTerms) {
    let added = 0;
    let updated = 0;
    for (const item of newTerms) {
      if (!item.ja || !item.en) continue;
      const existing = this.glossary.find((g) => g.ja === item.ja);
      if (existing) {
        existing.en = item.en;
        if (item.category) existing.category = item.category;
        if (item.reading) existing.reading = item.reading;
        if (Array.isArray(item.variants) && item.variants.length > 0) {
          existing.variants = item.variants;
        }
        if (item.note) existing.note = item.note;
        updated++;
      } else {
        this.glossary.unshift({
          id: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ja: item.ja,
          en: item.en,
          category: item.category || 'custom',
          reading: item.reading || '',
          variants: item.variants || [],
          note: item.note || '',
          enabled: item.enabled !== false,
        });
        added++;
      }
    }
    this.saveGlossary();
    this.renderGlossary();
    alert(`用語集の読み込みが完了しました（新規追加: ${added}件 / 更新: ${updated}件）`);
  }

  csvEscape(val) {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replaceAll('"', '""')}"`;
    }
    return str;
  }

  parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.graceApp = new GraceInterpretApp();
});
