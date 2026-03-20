// ==UserScript==
// @name         Amazonレビュー信頼度判定 & 無限スクロール (サクラ識別/品質チェック)
// @name:ja      Amazonレビュー信頼度判定 & 無限スクロール (サクラ識別/品質チェック)
// @name:en      Amazon Reviewer Trust Badge & Infinite Scroll (Quality Check)
// @namespace    https://github.com/koyasi777/amazon-review-trust-badge
// @version      1.7.2
// @description  Amazonのレビュアー投稿履歴を分析し、信頼度をS〜Dランクで視覚化（サクラ/やらせ/バイアス検出＆詳細レポート）。信頼度フィルタリング機能や、レビュー一覧の無限スクロール化も提供します。
// @description:ja  Amazonのレビュアー投稿履歴を分析し、信頼度をS〜Dランクで視覚化（サクラ/やらせ/バイアス検出＆詳細レポート）。信頼度フィルタリング機能や、レビュー一覧の無限スクロール化も提供します。
// @description:en Visualizes the reliability of Amazon reviewers (detects suspicious behavior/bias) and enables infinite scrolling for review pages.
// @author       koyasi777
// @license      MIT
// @match        https://www.amazon.co.jp/*
// @exclude      https://www.amazon.co.jp/gp/cart/*
// @exclude      https://www.amazon.co.jp/gp/buy/*
// @exclude      https://www.amazon.co.jp/ap/*
// @exclude      https://www.amazon.co.jp/gp/help/*
// @icon         https://raw.githubusercontent.com/koyasi777/amazon-review-trust-badge/refs/heads/main/icons/icon.png
// @updateURL    https://github.com/koyasi777/amazon-review-trust-badge/raw/main/amazon-review-trust-badge.user.js
// @downloadURL  https://github.com/koyasi777/amazon-review-trust-badge/raw/main/amazon-review-trust-badge.user.js
// @supportURL   https://github.com/koyasi777/amazon-review-trust-badge/issues
// @connect      amazon.co.jp
// @connect      www.amazon.co.jp
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.listValues
// @grant        GM.deleteValue
// @grant        GM.registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // =============================================================================
    // 0. Configuration
    // =============================================================================
    const CONFIG = {
        APP_NAME: 'TrustBadge',
        VERSION: '1.7.1',
        CACHE: { PREFIX: 'tr4:', TTL_SUCCESS: 604800000, TTL_FAIL: 86400000 },
        NETWORK: {
            MIN_INTERVAL: 2400,
            JITTER: 1500,
            TIMEOUT: 15000,
            LOCK_DURATION: 15 * 60 * 1000,
            MAX_CONCURRENT: 2
        },
        SCORING: {
            BASE: 50,
            BONUS: {
                DIVERSITY: 7, DETAIL: 10, IMAGE: 8,
                HELPFUL_MAX: 10, GOLD_MAX: 15
            },
            PENALTY: {
                ALL_FIVE: -25, THIN: -15, SWARM: -20, GAP: -30
            },
            CONTEXT_PENALTY: {
                NON_VP: -10, // 未購入
                VINE: -7     // Vine提供品
            },
            GRADES: { S: 90, A: 75, B: 50, C: 30, D: 0 }
        },
        TEXT: {
            TAGS: {
                'Div':     { label: '自然分布', desc: '評価の分布が自然で、極端な偏りが見られない傾向にあります。', color: '#718096', bg: '#edf2f7', border: '#cbd5e0' },
                'Deep':    { label: '長文詳細', desc: '比較的文字数の多い、詳細なレビューを投稿する傾向があります。', color: '#276749', bg: '#f0fff4', border: '#9ae6b4' },
                'Img':     { label: '写真投稿あり', desc: '過去に商品写真を投稿しており、実機確認の信頼性が比較的高いです。',   color: '#285e61', bg: '#e6fffa', border: '#81e6d9' },
                'Gold':    { label: '高品質',   desc: '詳細なレビューに対し、継続的に他者からの評価を得ているレビュアーです。',   color: '#b7791f', bg: '#fefcbf', border: '#f6e05e' },
                'Helpful': { label: '高参考票', desc: '他ユーザーから「参考になった」の票を多く集めている傾向があります。', color: '#2b6cb0', bg: '#bee3f8', border: '#90cdf4' },
                'All5':    { label: '全件★5',   desc: '投稿済みレビューが全て★5です。強いバイアスが含まれる可能性があります。',    color: '#c53030', bg: '#fff5f5', border: '#fc8181' },
                'Thin':    { label: '内容希薄', desc: '全体的に投稿内容が短く、情報密度が低い傾向が見られます。', color: '#975a16', bg: '#fffaf0', border: '#fbd38d' },
                'Swarm':   { label: '組織票疑', desc: '内容量に対し、不自然に多くの票が入っている投稿が確認されます。', color: '#822727', bg: '#fed7d7', border: '#feb2b2' },
                'Few':     { label: '投稿数少', desc: '総レビュー数が少ないため、データ不足により判定精度が限定的です。', color: '#c05621', bg: '#fffaf0', border: '#fbd38d' },
                'Gap':     { label: '品質乖離', desc: '高評価とその他の評価で、レビューの熱量や詳細さに不自然な乖離が見られます。', color: '#553c9a', bg: '#faf5ff', border: '#d6bcfa' }
            },
            CONTEXT: {
                'VP':   { label: '購入済', desc: 'Amazonでの購入履歴（Amazonで購入ラベル）が確認されたレビューです。', color: '#ebf8f2', border: '#48bb78', text: '#2f855a' },
                'VINE': { label: 'Vine(無償提供)', desc: 'Vineプログラムにより無償提供された商品です。好意的なバイアスの可能性があります。', color: '#fffff0', border: '#d69e2e', text: '#744210' },
                'NON':  { label: '未購入', desc: 'Amazon上での購入履歴が確認できません。外部購入等の可能性があります。', color: '#fff5f5', border: '#fc8181', text: '#c53030' }
            },
            LABELS: {
                CNT:       '総レビュー数',
                LEN:       '平均文字数',
                IMG:       '写真投稿率',
                HELPFUL:   '平均参考票',
                UNCERTAIN: 'データ不足により判定不可'
            }
        }
    };

    // =============================================================================
    // 1. Cache Manager
    // =============================================================================
    class CacheManager {
        static getKey(id) { return `${CONFIG.CACHE.PREFIX}${id}`; }
        static async get(id) {
            try {
                const raw = await GM.getValue(this.getKey(id));
                if (!raw) return null;
                const d = JSON.parse(raw);
                if (Date.now() > d.exp) { await GM.deleteValue(this.getKey(id)); return null; }
                return d;
            } catch { return null; }
        }
        static async set(id, data, type = 'SUCCESS') {
            const ttl = type === 'SUCCESS' ? CONFIG.CACHE.TTL_SUCCESS : CONFIG.CACHE.TTL_FAIL;
            await GM.setValue(this.getKey(id), JSON.stringify({ v: 8, ts: Date.now(), exp: Date.now() + ttl, ...data }));
        }
        static async remove(id) {
            await GM.deleteValue(this.getKey(id));
        }
    }

    // =============================================================================
    // 2. Network Manager
    // =============================================================================
    class NetworkManager {
        static queue = [];
        static activeCount = 0; // 現在実行中のリクエスト数
        static circuitOpen = false;

        static async fetch(url, priority = false) {
            if (this.circuitOpen) throw new Error('CIRCUIT_OPEN: Emergency Lock');

            // ロックチェック
            const lockUntil = await GM.getValue('emergency_lock', 0);
            if (Date.now() < lockUntil) {
                this.circuitOpen = true;
                throw new Error(`Locked until ${new Date(lockUntil).toLocaleTimeString()}`);
            }

            return new Promise((resolve, reject) => {
                const item = { url, resolve, reject };
                if (priority) {
                    this.queue.unshift(item); // 優先キュー
                } else {
                    this.queue.push(item);
                }
                this.processQueue();
            });
        }

        static processQueue() {
            if (this.circuitOpen) return;

            // 定義された最大並列数(MAX_CONCURRENT)に達するまでワーカーを起動
            while (this.queue.length > 0 && this.activeCount < CONFIG.NETWORK.MAX_CONCURRENT) {
                this._runWorker();
            }
        }

        static async _runWorker() {
            if (this.queue.length === 0) return;

            this.activeCount++;
            const { url, resolve, reject } = this.queue.shift();

            try {
                // 並列処理では「一律待機」ではなく「ワーカーごとのランダム待機」でアクセスを分散させる
                // これにより機械的なアクセスパターンを回避する
                const wait = CONFIG.NETWORK.MIN_INTERVAL + Math.random() * CONFIG.NETWORK.JITTER;
                await new Promise(r => setTimeout(r, wait));

                const responseText = await this._execRequest(url);

                if (this._detectRobot(responseText)) {
                    await this._triggerCircuitBreaker();
                    throw new Error('ROBOT_DETECTED');
                }
                resolve(responseText);
            } catch (e) {
                reject(e);
            } finally {
                this.activeCount--;
                // 完了後、次のタスクがあれば即座に取り掛かる
                this.processQueue();
            }
        }

        static _execRequest(url) {
            return new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: 'GET', url: url, timeout: CONFIG.NETWORK.TIMEOUT,
                    onload: (res) => {
                        if (res.status === 200) resolve(res.responseText || '');
                        else if (res.status === 404) reject(new Error('NOT_FOUND'));
                        else reject(new Error(`HTTP_${res.status}`));
                    },
                    onerror: () => reject(new Error('NET_ERR')),
                    ontimeout: () => reject(new Error('TIMEOUT'))
                });
            });
        }

        static _detectRobot(html) {
            return html.includes('Amazon CAPTCHA') || html.includes('Robot Check');
        }

        static async _triggerCircuitBreaker() {
            if (this.circuitOpen) return;
            console.error('⚠️ AMAZON ROBOT DETECTED: Opening Circuit Breaker.');
            this.circuitOpen = true;
            const lockUntil = Date.now() + CONFIG.NETWORK.LOCK_DURATION;
            await GM.setValue('emergency_lock', lockUntil);

            // 待機中のキューを全て破棄して即時停止
            this.queue.forEach(q => q.reject(new Error('CIRCUIT_OPEN_ABORT')));
            this.queue = [];
        }
    }

    // =============================================================================
    // 3. Parser
    // =============================================================================
    class Parser {
        static parse(html) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const reviews = [];
            let strategy = 'UNKNOWN';
            let globalImageCount = 0;

            const stateReviews = this._scanProfileState(doc);
            if (stateReviews.length > 0) {
                strategy = 'STATE_JSON';
                reviews.push(...stateReviews);
                globalImageCount = reviews.filter(r => r.hasImage).length;
            } else {
                const domReviews = this._scanModernDOM(doc);
                if (domReviews.length > 0) {
                    strategy = 'MODERN_DOM';
                    reviews.push(...domReviews);
                    globalImageCount = reviews.filter(r => r.hasImage).length;
                } else {
                    const legacyReviews = this._scanLegacyDOM(doc);
                    if (legacyReviews.length > 0) {
                        strategy = 'LEGACY_DOM';
                        reviews.push(...legacyReviews);
                        globalImageCount = this._countImagesRegex(html);
                    }
                }
            }

            if (reviews.length === 0) {
                if (html.includes('レビューは非表示になっています。')) {
                    return { error: 'HIDDEN' };
                }
                if (html.includes('公開されているアクティビティはありません') || html.includes('private-profile')) {
                    return { error: '非公開' };
                }
                return { error: 'NO_DATA', meta: { strategy, globalImageCount } };
            }
            return { reviews, meta: { strategy, globalImageCount } };
        }

        static _extractHelpful(rm) {
            if (typeof rm.hearts === 'number' && rm.hearts > 0) return rm.hearts;
            if (rm.helpfulVoteText) {
                const m = rm.helpfulVoteText.match(/(\d+)人/);
                return m ? parseInt(m[1], 10) : 0;
            }
            return 0;
        }

        static _scanProfileState(doc) {
            const results = [];
            try {
                doc.querySelectorAll('script[type="a-state"]').forEach(tag => {
                    const dataState = tag.getAttribute('data-a-state');
                    if (dataState && dataState.includes('page-state-profile')) {
                        const json = JSON.parse(tag.textContent);
                        if (json.reviewsTimeline?.shopItemModels) {
                            json.reviewsTimeline.shopItemModels.forEach(item => {
                                if (item.itemContentType === 'Review' && item.reviewModel) {
                                    const rm = item.reviewModel;
                                    results.push({
                                        star: parseInt(rm.rating, 10) || 3,
                                        len: (rm.description || '').length,
                                        hasImage: Array.isArray(rm.visualElements) && rm.visualElements.length > 0,
                                        helpful: this._extractHelpful(rm),
                                        isVine: (rm.badges && rm.badges.includes('Vine')) || false
                                    });
                                }
                            });
                        }
                    }
                });
            } catch (e) {}
            return results;
        }

        static _scanModernDOM(doc) {
            const results = [];
            doc.querySelectorAll('.review-card-container').forEach(card => {
                try {
                    let star = 3;
                    const starEl = card.querySelector('i.a-icon-star');
                    if (starEl) {
                        const m = starEl.className.match(/a-star-(\d)/);
                        if(m) star = parseInt(m[1], 10);
                    }
                    const text = card.querySelector('.review-description')?.textContent.trim() || '';
                    const hasImage = !!card.querySelector('img.review-image');
                    const helpEl = card.querySelector('.review-reaction-count');
                    const helpful = helpEl ? (parseInt(helpEl.textContent.trim(), 10) || 0) : 0;

                    results.push({ star, len: text.length, hasImage, helpful, isVine: false });
                } catch (e) { }
            });
            return results;
        }

        static _scanLegacyDOM(doc) {
            const results = [];
            doc.querySelectorAll('.my-profile-review-card, .a-section.review, div[id^="customer_review"]').forEach(card => {
                if (card.classList.contains('review-card-container')) return;
                try {
                    let star = 3;
                    const starEl = card.querySelector('[class*="a-star-"]');
                    if (starEl) {
                        const m = starEl.className.match(/a-star-(?:medium-)?(\d)/);
                        if(m) star = parseInt(m[1], 10);
                    }
                    const text = card.querySelector('.review-description, .review-text-content')?.innerText.trim() || '';
                    const hasImg = !!card.querySelector('.review-image-tile, img.review-image');
                    const helpEl = card.querySelector('[data-hook="helpful-vote-statement"]');
                    let helpful = 0;
                    if(helpEl) {
                        const m = helpEl.innerText.match(/(\d+)人/);
                        if(m) helpful = parseInt(m[1], 10);
                    }
                    const isVine = !!card.innerText.includes('Vine先取り');
                    results.push({ star, len: text.length, hasImage: hasImg, helpful, isVine });
                } catch(e) {}
            });
            return results;
        }

        static _countImagesRegex(html) {
            const matches = html.match(/class=\\?["']review-image\\?["']|"mediaType"\s*:\s*"image"/g);
            return matches ? matches.length : 0;
        }
    }

    // =============================================================================
    // 4. Scorer
    // =============================================================================
    class Scorer {
        static analyze(reviews, globalImageCount = 0) {
            const emptyStats = { cnt: 0, sDist: [0,0,0,0,0,0], lenAvg: 0, imgR: 0, avgHelpful: 0, flags: {} };
            const emptyScore = { val: 0, grd: '?', uncertain: true, why: ['NoData'] };
            if (!reviews || reviews.length === 0) return { stats: emptyStats, score: emptyScore };

            const stats = { cnt: reviews.length, sDist: [0,0,0,0,0,0], lenAvg: 0, imgR: 0, avgHelpful: 0, flags: {} };
            let sumS=0, sumL=0, imgC=0, sumHelpful=0, suspiciousHelpfulCount=0;
            let shortLenCnt = 0;
            const domImageDetected = reviews.some(r => r.hasImage);

            let goldHelpfulSum = 0;
            let goldReviewCnt = 0;
            const targetReviews = [];
            const camoReviews = [];

            reviews.forEach(r => {
                const s = (typeof r.star === 'number') ? r.star : 3;
                stats.sDist[s]++; sumS+=s;

                if (s === 5) targetReviews.push(r);
                else if (s >= 2 && s <= 4) camoReviews.push(r);

                const len = r.len || 0;
                sumL += len;
                if (len < 20) shortLenCnt++;

                if(r.hasImage) imgC++;
                const h = r.helpful || 0;
                sumHelpful += h;

                if (!r.hasImage && len < 40 && h >= 3) suspiciousHelpfulCount++;

                if ((s >= 2 && s <= 4) && len >= 150) {
                    if (h >= 3) goldReviewCnt++;
                    if (h >= 1) goldHelpfulSum += h;
                }
            });

            stats.sMean = sumS / stats.cnt;
            stats.lenAvg = sumL / stats.cnt;
            stats.avgHelpful = sumHelpful / stats.cnt;

            if (domImageDetected) stats.imgR = imgC / stats.cnt;
            else if (globalImageCount > 0) stats.imgR = Math.min(1.0, globalImageCount / stats.cnt);
            else stats.imgR = 0;

            stats.flags.allFive = (stats.sDist[5] === stats.cnt);
            stats.flags.diverse = (stats.sDist[2]+stats.sDist[3]+stats.sDist[4]) >= 2;
            stats.flags.thin = (stats.lenAvg > 0 && stats.lenAvg < 40) || (shortLenCnt >= 2);
            stats.flags.swarm = suspiciousHelpfulCount >= 2;

            stats.flags.gap = false;
            if (targetReviews.length > 0 && camoReviews.length > 0) {
                const avgCamoLen = camoReviews.reduce((a,b)=>a+b.len,0) / camoReviews.length;
                const avgTargetLen = targetReviews.reduce((a,b)=>a+b.len,0) / targetReviews.length;
                if (avgCamoLen >= 120 && avgTargetLen < (avgCamoLen * 0.35)) {
                    stats.flags.gap = true;
                }
            }

            const R = CONFIG.SCORING;
            let sc = R.BASE;
            const why = [];

            if (stats.cnt < 5) why.push('Few');

            if (stats.flags.allFive) { sc += R.PENALTY.ALL_FIVE; why.push('All5'); }
            if (stats.flags.thin) { sc += R.PENALTY.THIN; why.push('Thin'); }
            if (stats.flags.swarm) { sc += R.PENALTY.SWARM; why.push('Swarm'); }
            if (stats.flags.gap) { sc += R.PENALTY.GAP; why.push('Gap'); }

            if (stats.flags.diverse) { sc += R.BONUS.DIVERSITY; why.push('Div'); }
            if (stats.lenAvg >= 150) { sc += R.BONUS.DETAIL; why.push('Deep'); }
            if (stats.imgR >= 0.1) { sc += R.BONUS.IMAGE; why.push('Img'); }

            if (!stats.flags.swarm) {
                if ((goldReviewCnt > 0 || goldHelpfulSum > 0) && !stats.flags.gap) {
                    const countScore = goldReviewCnt * 1.5;
                    const voteScore = Math.log2(goldHelpfulSum + 1) * 2.0;
                    const goldBonus = Math.min(R.BONUS.GOLD_MAX, Math.round(countScore + voteScore));
                    sc += goldBonus;
                    if (goldBonus >= 3) why.push('Gold');
                }

                if (stats.avgHelpful > 0) {
                    const hBonus = Math.min(R.BONUS.HELPFUL_MAX, Math.round(Math.log2(stats.avgHelpful + 1) * 2.5));
                    sc += hBonus;
                    if (stats.avgHelpful >= 3.0 && !why.includes('Gold')) why.push('Helpful');
                }
            }

            sc = Math.max(0, Math.min(100, sc));
            return { stats, score: { val: Math.round(sc), uncertain: stats.cnt<5, why } };
        }

        static getGrade(score) {
            const R = CONFIG.SCORING;
            if (score >= R.GRADES.S) return 'S';
            if (score >= R.GRADES.A) return 'A';
            if (score >= R.GRADES.B) return 'B';
            if (score >= R.GRADES.C) return 'C';
            return 'D';
        }
    }

    // =============================================================================
    // 5. Filter Manager
    // =============================================================================
    class FilterManager {
        static currentGrade = 'b';
        static isIsActive = true;
        static STORAGE_KEY_GRADE = 'tb_filter_grade_v2';
        static STORAGE_KEY_IS = 'tb_infinite_scroll_active';

        static async init() {
            try {
                const savedGrade = await GM.getValue(this.STORAGE_KEY_GRADE, 'b');
                if (['all', 's', 'a', 'b', 'c'].includes(savedGrade)) {
                    this.currentGrade = savedGrade;
                }
                this.isIsActive = await GM.getValue(this.STORAGE_KEY_IS, true);
            } catch (e) {
                console.error('TrustBadge: Failed to load settings', e);
            }

            this.injectCSS();

            setInterval(() => {
                this.injectUI();
                this.syncFilter();
            }, 1000);
        }

        static injectCSS() {
            const s = document.createElement('style');
            s.textContent = `
                /* フィルタ用スタイル */
                .tb-filter-s [data-tb-grade="A"], .tb-filter-s [data-tb-grade="B"], .tb-filter-s [data-tb-grade="C"], .tb-filter-s [data-tb-grade="D"], .tb-filter-s [data-tb-grade="ERR"] { display: none !important; }
                .tb-filter-a [data-tb-grade="B"], .tb-filter-a [data-tb-grade="C"], .tb-filter-a [data-tb-grade="D"], .tb-filter-a [data-tb-grade="ERR"] { display: none !important; }
                .tb-filter-b [data-tb-grade="C"], .tb-filter-b [data-tb-grade="D"], .tb-filter-b [data-tb-grade="ERR"] { display: none !important; }
                .tb-filter-c [data-tb-grade="D"], .tb-filter-c [data-tb-grade="ERR"] { display: none !important; }

                /* UI Row Style */
                .tb-ui-row {
                    clear: both;
                    padding: 10px 0 5px 2px; /* 余白調整 */
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    margin-bottom: 15px;
                }

                /* Dropdown UI */
                .tb-filter-select-container { display: inline-flex; align-items: center; gap: 8px; position: relative; }
                .tb-filter-select {
                    appearance: none; -moz-appearance: none; -webkit-appearance: none;
                    background: #f0f2f2; border: 1px solid #d5d9d9; border-radius: 8px;
                    box-shadow: 0 2px 5px rgba(213,217,217,.5); padding: 0 22px 0 11px;
                    height: 29px; font-size: 11px; line-height: 29px; color: #111;
                    cursor: pointer; outline: 0; min-width: 140px;
                }
                .tb-filter-select:hover { background: #e3e6e6; }
                .tb-filter-select:focus { background: #e7f4f5; border-color: #007185; box-shadow: 0 0 0 3px #c2dbdf; }
                .tb-arrow {
                    position: absolute; right: 8px; top: 11px;
                    border: 4px solid transparent; border-top-color: #555; pointer-events: none;
                }

                /* Toggle Switch UI */
                .tb-toggle-wrapper { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
                .tb-toggle-label { font-size: 11px; color: #333; font-weight: bold; }
                .tb-toggle-input { display: none; }
                .tb-toggle-bg {
                    position: relative; width: 32px; height: 18px;
                    background: #ccc; border-radius: 9px;
                    transition: background 0.2s ease;
                }
                .tb-toggle-bg::after {
                    content: ''; position: absolute; top: 2px; left: 2px;
                    width: 14px; height: 14px; background: #fff; border-radius: 50%;
                    transition: left 0.2s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                }
                .tb-toggle-input:checked + .tb-toggle-bg { background: #007185; }
                .tb-toggle-input:checked + .tb-toggle-bg::after { left: 16px; }
            `;
            document.head.appendChild(s);
        }

        static injectUI() {
            if (document.getElementById('tb-filter-ui')) {
                const select = document.getElementById('tb-grade-filter');
                if (select && select.value !== this.currentGrade) select.value = this.currentGrade;
                return;
            }

            // ターゲットを cm_cr-view_opt_sort_filter に変更
            const targetContainer = document.getElementById('cm_cr-view_opt_sort_filter');
            if (!targetContainer) return;

            const wrapper = document.createElement('div');
            wrapper.id = 'tb-filter-ui';
            wrapper.className = 'tb-ui-row';
            wrapper.innerHTML = `
                <label class="tb-toggle-wrapper" title="自動で次のページを読み込みます">
                    <span class="tb-toggle-label">無限スクロール</span>
                    <input type="checkbox" id="tb-is-toggle" class="tb-toggle-input" ${this.isIsActive ? 'checked' : ''}>
                    <div class="tb-toggle-bg"></div>
                </label>

                <div class="tb-filter-select-container">
                    <div style="font-size:10px;color:#555;font-weight:bold;">信頼度:</div>
                    <div style="position:relative">
                        <select id="tb-grade-filter" class="tb-filter-select">
                            <option value="all">全ての信頼度</option>
                            <option value="s">S (最高品質) のみ</option>
                            <option value="a">A (高品質) 以上</option>
                            <option value="b">B (普通) 以上</option>
                            <option value="c">C (低品質) 以上 (D除外)</option>
                        </select>
                        <i class="tb-arrow"></i>
                    </div>
                </div>
            `;

            // targetContainerの直後に挿入 (afterend)
            targetContainer.insertAdjacentElement('afterend', wrapper);

            const select = document.getElementById('tb-grade-filter');
            select.value = this.currentGrade;
            this.applyFilter(this.currentGrade);

            select.addEventListener('change', (e) => this.applyFilter(e.target.value));

            const toggle = document.getElementById('tb-is-toggle');
            toggle.addEventListener('change', async (e) => {
                const isActive = e.target.checked;
                this.isIsActive = isActive;
                await GM.setValue(this.STORAGE_KEY_IS, isActive);
                if (typeof IS_Logic !== 'undefined') {
                    IS_Logic.toggle(isActive);
                }
            });

            setTimeout(() => {
                 if (typeof IS_Logic !== 'undefined') IS_Logic.toggle(this.isIsActive);
            }, 500);
        }

        static syncFilter() {
            // UIを挿入するターゲット（ソートオプションバー）が存在しないページ（個別レビュー画面など）では
            // フィルタリングを強制的に解除し、何も隠さないようにする。
            // これにより「スイッチがないのに勝手に消える」現象を防ぐ。
            if (!document.getElementById('cm_cr-view_opt_sort_filter')) {
                const targets = document.querySelectorAll('#cm_cr-review_list, #amz-scroll-review-archive, #amz-scroll-internal-list');
                targets.forEach(listContainer => {
                    listContainer.classList.remove('tb-filter-s', 'tb-filter-a', 'tb-filter-b', 'tb-filter-c');
                });
                return;
            }

            const targets = document.querySelectorAll('#cm_cr-review_list, #amz-scroll-review-archive, #amz-scroll-internal-list');
            const cls = `tb-filter-${this.currentGrade}`;
            let needsUpdate = false;
            targets.forEach(t => {
                if (this.currentGrade !== 'all' && !t.classList.contains(cls)) needsUpdate = true;
            });
            if (needsUpdate) this.applyFilter(this.currentGrade);
        }

        static async applyFilter(gradeKey) {
            this.currentGrade = gradeKey;
            GM.setValue(this.STORAGE_KEY_GRADE, gradeKey).catch(e => console.error(e));
            const targets = document.querySelectorAll('#cm_cr-review_list, #amz-scroll-review-archive, #amz-scroll-internal-list');
            targets.forEach(listContainer => {
                listContainer.classList.remove('tb-filter-s', 'tb-filter-a', 'tb-filter-b', 'tb-filter-c');
                if (gradeKey !== 'all') listContainer.classList.add(`tb-filter-${gradeKey}`);
            });
        }
    }

    // =============================================================================
    // 6. UI Manager
    // =============================================================================
    class UIManager {
        constructor() {
            this.createOverlay();
            const s = document.createElement('style');
            s.textContent = `
                .tb-wrapper { display: inline-flex; align-items: center; gap: 4px; vertical-align: middle; margin-left: 8px; font-family: "Amazon Ember", Arial, sans-serif; line-height:1; }
                .tb-badge { padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid transparent; color: #555; user-select: none; transition: all 0.2s; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: inline-flex; align-items: center; gap: 4px; background: #fdfdfd; border-color: #e2e8f0; }
                .tb-badge:hover { transform: translateY(-1px); box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                .tb-queue { background: #f7fafc; color: #718096; border-color: #cbd5e0; animation: tb-breath 2s infinite ease-in-out; }
                .tb-queue::before { content: "⏱"; font-size: 11px; opacity: 0.8; }
                .tb-queue::after { content: "待機中"; font-size: 10px; margin-left: 4px; opacity: 0.8; }
                .tb-queue:hover { background: #fffaf0; border-color: #fbd38d; color: #c05621; animation: none; transform: translateY(-2px) scale(1.05); box-shadow: 0 4px 12px rgba(237, 137, 54, 0.25); }
                .tb-queue:hover::before { content: "⚡"; }
                .tb-queue:hover::after { content: "今すぐ解析"; font-weight: bold; }
                .tb-loading { background: #ebf8ff; border-color: #90cdf4; color: #2b6cb0; cursor: pointer; }
                .tb-loading::before { content: "↻"; display: inline-block; animation: tb-spin 0.8s linear infinite; font-size: 12px; }
                .tb-loading::after { content: "解析中..."; font-size: 10px; margin-left: 4px; }
                .tb-error { background: #fff5f5; border-color: #fc8181; color: #c53030; }
                .tb-grade-S { background: #c6f6d5; border-color: #48bb78; color: #22543d; }
                .tb-grade-A { background: #f0fff4; border-color: #9ae6b4; color: #276749; }
                .tb-grade-B { background: #fffff0; border-color: #fbd38d; color: #744210; }
                .tb-grade-C { background: #fffaf0; border-color: #f6ad55; color: #9c4221; }
                .tb-grade-D { background: #fff5f5; border-color: #fc8181; color: #9b2c2c; }
                @keyframes tb-breath { 0%{border-color:#cbd5e0;} 50%{border-color:#a0aec0; background:#edf2f7;} 100%{border-color:#cbd5e0;} }
                @keyframes tb-spin  { 100% { transform: rotate(360deg); } }
                .tb-tags-container { display: inline-flex; gap: 2px; cursor: pointer; }
                .tb-tag-inline { font-size: 9px; padding: 1px 4px; border-radius: 3px; border: 1px solid; cursor: pointer; white-space: nowrap; transition: opacity 0.2s; }
                .tb-tag-inline:hover { opacity: 0.8; }
                .tb-ctx-mini { font-size: 9px; padding: 1px 4px; border-radius: 3px; border: 1px solid; cursor: pointer; }
                .tb-ctx-vp    { background: ${CONFIG.TEXT.CONTEXT.VP.color}; border-color: ${CONFIG.TEXT.CONTEXT.VP.border}; color: ${CONFIG.TEXT.CONTEXT.VP.text}; }
                .tb-ctx-vine { background: ${CONFIG.TEXT.CONTEXT.VINE.color}; border-color: ${CONFIG.TEXT.CONTEXT.VINE.border}; color: ${CONFIG.TEXT.CONTEXT.VINE.text}; }
                .tb-ctx-non  { background: ${CONFIG.TEXT.CONTEXT.NON.color}; border-color: ${CONFIG.TEXT.CONTEXT.NON.border}; color: ${CONFIG.TEXT.CONTEXT.NON.text}; }
                .tb-reload-mini { cursor: pointer; color: #888; font-size: 14px; padding: 0 4px; border-radius: 50%; transition: all 0.3s; display: none; }
                .tb-reload-mini:hover { color: #333; background: #f0f0f0; }
                .tb-reload-mini.act { display: inline-block; }
                .tb-reload-mini.spinning { animation: tb-spin 0.8s linear infinite; pointer-events: none; color: #ccc; }
                #tb-pop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; display: none; align-items: center; justify-content: center; }
                #tb-pop.act { display: flex; }
                .tb-win { background: #fff; width: 95%; max-width: 420px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); font-family: "Amazon Ember", sans-serif; position: relative; }
                .tb-head { padding: 12px 16px; background: #f7f7f7; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #333; border-top-left-radius: 8px; border-top-right-radius: 8px; }
                .tb-bod { padding: 20px; font-size: 13px; color: #333; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; }
                .tb-score-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
                .tb-grade-lg { font-size: 32px; font-weight: bold; line-height: 1; }
                .tb-val-lg { font-size: 20px; color: #555; }
                .tb-tag { display: inline-block; background: #eee; padding: 2px 8px; border-radius: 12px; margin: 0 4px 4px 0; font-size: 11px; color: #555; position: relative; cursor: help; }
                .tb-tag::before { content: attr(data-tooltip); position: absolute; top: 100%; left: 50%; transform: translateX(-50%) translateY(5px); padding: 8px 12px; background: #2d3748; color: #fff; font-size: 11px; line-height: 1.4; border-radius: 4px; white-space: normal; width: max-content; max-width: 240px; text-align: left; opacity: 0; visibility: hidden; transition: opacity 0.2s, transform 0.2s; pointer-events: none; z-index: 10000; box-shadow: 0 4px 10px rgba(0,0,0,0.2); font-weight: normal; }
                .tb-tag::after { content: ''; position: absolute; top: 100%; left: 50%; margin-top: -5px; transform: translateX(-50%) translateY(5px); border-width: 5px; border-style: solid; border-color: transparent transparent #2d3748 transparent; opacity: 0; visibility: hidden; transition: opacity 0.2s, transform 0.2s; z-index: 10000; }
                .tb-tag:hover::before, .tb-tag:hover::after { opacity: 1; visibility: visible; transform: translateX(-50%) translateY(10px); }
                .tb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; padding-top: 16px; border-top: 1px solid #eee; }
                .tb-item { display: flex; justify-content: space-between; }
                .tb-label { color: #666; } .tb-data { font-weight: bold; }
                .tb-meta { margin-top: 16px; font-size: 10px; color: #999; display: flex; justify-content: space-between; align-items: center; }
                .tb-reload-btn { background: #fff; border: 1px solid #ccc; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 11px; color: #333; }
                .tb-reload-btn:hover { background: #f0f0f0; }
                .tb-context-alert { margin-bottom: 12px; padding: 8px; border-radius: 4px; font-size: 12px; display: flex; align-items: center; gap: 8px; font-weight: bold; }
                .tb-ctx-alert-vp    { background: ${CONFIG.TEXT.CONTEXT.VP.color}; border: 1px solid ${CONFIG.TEXT.CONTEXT.VP.border}; color: ${CONFIG.TEXT.CONTEXT.VP.text}; }
                .tb-ctx-alert-vine { background: ${CONFIG.TEXT.CONTEXT.VINE.color}; border: 1px solid ${CONFIG.TEXT.CONTEXT.VINE.border}; color: ${CONFIG.TEXT.CONTEXT.VINE.text}; }
                .tb-ctx-alert-non  { background: ${CONFIG.TEXT.CONTEXT.NON.color}; border: 1px solid ${CONFIG.TEXT.CONTEXT.NON.border}; color: ${CONFIG.TEXT.CONTEXT.NON.text}; }
                details { margin-top: 10px; } summary { cursor: pointer; font-size: 10px; color: #007185; } pre { font-size: 10px; background: #333; color: #fff; padding: 8px; border-radius: 4px; overflow: auto; max-height: 150px; }
                /* 分布グラフ用スタイル */
                .tb-chart-box { margin: 12px 0; padding: 10px; background: #fcfcfc; border: 1px solid #f0f0f0; border-radius: 4px; }
                .tb-chart-row { display: flex; align-items: center; font-size: 10px; margin-bottom: 3px; color: #555; }
                .tb-chart-label { width: 20px; text-align: right; margin-right: 6px; font-family: monospace; }
                .tb-bar-bg { flex: 1; height: 8px; background: #edf2f7; border-radius: 2px; overflow: hidden; }
                .tb-bar-fill { height: 100%; background: #f0c14b; border-right: 1px solid #cd9042; }
                .tb-chart-val { width: 30px; text-align: right; margin-left: 6px; color: #777; }
            `;
            document.head.appendChild(s);
        }

        createOverlay() {
            const d = document.createElement('div'); d.id = 'tb-pop';
            d.innerHTML = `<div class="tb-win"><div class="tb-head"><span>信頼度分析レポート</span><span style="cursor:pointer;font-size:18px" onclick="document.getElementById('tb-pop').classList.remove('act')">✕</span></div><div class="tb-bod" id="tb-bod"></div></div>`;
            document.body.appendChild(d);
            this.b = document.getElementById('tb-bod');
            this.c = d;
            d.onclick = e => { if(e.target === d) d.classList.remove('act'); };
        }

        translateTags(tags) {
            return (tags || []).map(t => {
                const conf = CONFIG.TEXT.TAGS[t];
                return conf
                    ? { key: t, label: conf.label, desc: conf.desc, style: `background:${conf.bg};border-color:${conf.border};color:${conf.color}` }
                    : { key: t, label: t, desc: '', style: '' };
            });
        }

        show(d, id, triggerWrapper, context) {
            if (d.err) {
                if (d.err.type === 'HIDDEN') {
                    this.b.innerHTML = `
                        <div style="text-align:center; padding: 20px 0; color: #555;">
                            <div style="font-size: 24px; margin-bottom: 8px;">🔒</div>
                            <div style="font-weight:bold; font-size: 14px;">レビュー非表示</div>
                            <p style="font-size: 12px; color: #777; margin-top: 4px;">このユーザーはレビューの公開設定をオフにしています。</p>
                            <div style="margin-top:8px">
                                <a href="https://www.amazon.co.jp/gp/profile/${id}" target="_blank" rel="noopener noreferrer" style="font-size:11px; color:#007185; text-decoration:none; border-bottom:1px solid #007185;">プロフィールを確認 ↗</a>
                            </div>
                            <div style="margin-top:15px"><button id="tb-reload-pop" class="tb-reload-btn">🔄 再確認</button></div>
                        </div>
                    `;
                    const rBtn = document.getElementById('tb-reload-pop');
                    if(rBtn) rBtn.onclick = async () => { this.c.classList.remove('act'); await App.reload(id, triggerWrapper, context); };
                    this.c.classList.add('act');
                    return;
                }

                const prev = d.htmlPreview ? d.htmlPreview.replace(/</g,'&lt;') : '';
                this.b.innerHTML = `
                    <div style="color:#c53030;font-weight:bold;margin-bottom:8px;">⚠️ ${CONFIG.TEXT.LABELS.UNCERTAIN}</div>
                    <p>${d.err.msg}</p>
                    <div style="margin-top:20px;text-align:center"><button id="tb-reload-pop" class="tb-reload-btn">🔄 再取得する</button></div>
                    <details><summary>Debug Info</summary><pre>${JSON.stringify(d.err,null,2)}\n\n${prev}</pre></details>
                `;
            } else {
                let finalVal = d.sc.val;
                let whyList = [...d.sc.why];
                const alerts = [];

                if (context.isVP) {
                } else {
                    if (context.isVine) {
                        finalVal += CONFIG.SCORING.CONTEXT_PENALTY.VINE;
                        alerts.push(`<div class="tb-context-alert tb-ctx-alert-vine">ℹ️ ${CONFIG.TEXT.CONTEXT.VINE.label}<br><span style="font-weight:normal;font-size:10px">無料提供品バイアス (${CONFIG.SCORING.CONTEXT_PENALTY.VINE})</span></div>`);
                    } else {
                        finalVal += CONFIG.SCORING.CONTEXT_PENALTY.NON_VP;
                        alerts.push(`<div class="tb-context-alert tb-ctx-alert-non">⚠️ ${CONFIG.TEXT.CONTEXT.NON.label}<br><span style="font-weight:normal;font-size:10px">未購入レビュー (${CONFIG.SCORING.CONTEXT_PENALTY.NON_VP})</span></div>`);
                    }
                }

                finalVal = Math.min(100, Math.max(0, finalVal));
                const finalGrade = Scorer.getGrade(finalVal);
                const { st, src } = d;
                const L = CONFIG.TEXT.LABELS;
                const unc = d.sc.uncertain ? `<span style="font-size:12px;color:#d69e2e;margin-left:8px">⚠️ ${L.UNCERTAIN}</span>` : '';

                // ▼ 分布グラフ生成ロジック ▼
                const dist = d.st.sDist;
                const maxVal = Math.max(...dist.slice(1));
                let chartHtml = '<div class="tb-chart-box"><div style="font-size:9px;color:#999;margin-bottom:4px">評価分布</div>';
                for (let i = 5; i >= 1; i--) {
                    const count = dist[i] || 0;
                    const width = maxVal > 0 ? Math.round((count / maxVal) * 100) : 0;
                    const barStyle = width === 0 ? 'width:0;border:none;' : `width:${width}%`;
                    chartHtml += `<div class="tb-chart-row"><span class="tb-chart-label">${i}★</span><div class="tb-bar-bg"><div class="tb-bar-fill" style="${barStyle}"></div></div><span class="tb-chart-val">${count}</span></div>`;
                }
                chartHtml += '</div>';

                const tags = this.translateTags(whyList);

                let ctxConf = null;
                if (context.isVP) ctxConf = CONFIG.TEXT.CONTEXT.VP;
                else if (context.isVine) ctxConf = CONFIG.TEXT.CONTEXT.VINE;
                else ctxConf = CONFIG.TEXT.CONTEXT.NON;

                if (ctxConf) {
                    tags.unshift({
                        key: 'CTX',
                        label: ctxConf.label,
                        desc: ctxConf.desc,
                        style: `background:${ctxConf.color};border-color:${ctxConf.border};color:${ctxConf.text}`
                    });
                }

                // プロフィールデータの準備
                const pName = context.name || 'Unknown User';
                const pImg = context.avatar || 'https://images-fe.ssl-images-amazon.com/images/S/amazon-avatars-global/default._CR0,0,1024,1024_SX48_.png';
                // IDがあればリンク先を生成（src.urlがあればそれを使う）
                const pLink = src.url || `https://www.amazon.co.jp/gp/profile/${id}`;

                this.b.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:12px; border-bottom:1px dashed #eee;">
                        <div class="tb-score-row" style="margin:0; flex-shrink:0; margin-right:12px;">
                            <span class="tb-grade-lg tb-grade-${finalGrade}" style="padding:4px 10px; border-radius:4px; border:1px solid currentcolor; font-size:24px;">${finalGrade}</span>
                            <span class="tb-val-lg" style="font-size:18px;">${finalVal}<small style="font-size:11px">/100</small></span>
                        </div>
                        <a href="${pLink}" target="_blank" rel="noopener noreferrer" style="display:flex; align-items:center; justify-content:flex-end; gap:10px; text-decoration:none; color:#333; flex:1; min-width:0; transition:opacity 0.2s;" title="プロフィールページを開く" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">
                            <img src="${pImg}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; border:1px solid #e2e8f0; flex-shrink:0;">
                            <span style="font-size:12px; font-weight:bold; color:#007185; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${pName} ↗</span>
                        </a>
                    </div>

                    ${alerts.join('')}
                    ${unc ? `<div style="margin-bottom:10px">${unc}</div>` : ''}

                    <div style="margin-bottom:12px;">
                        ${tags.map(t => `<span class="tb-tag" style="${t.style}" data-tooltip="${t.desc}">${t.label}</span>`).join('')}
                    </div>

                    ${chartHtml}

                    <div class="tb-grid">
                        <div class="tb-item"><span class="tb-label">${L.CNT}</span><span class="tb-data">${st.cnt}件</span></div>
                        <div class="tb-item"><span class="tb-label">${L.LEN}</span><span class="tb-data">${Math.round(st.lenAvg)}文字</span></div>
                        <div class="tb-item"><span class="tb-label">${L.IMG}</span><span class="tb-data">${Math.round(st.imgR*100)}%</span></div>
                        <div class="tb-item"><span class="tb-label">${L.HELPFUL}</span><span class="tb-data">${Math.round(st.avgHelpful*10)/10}</span></div>
                    </div>

                    <div class="tb-meta">
                        <div style="line-height:1.4; color:#999;">
                            Strat: ${src.type}<br>
                            ID: ${id}
                        </div>
                        <button id="tb-reload-pop" class="tb-reload-btn">🔄 再取得</button>
                    </div>
                `;
            }
            const rBtn = document.getElementById('tb-reload-pop');
            if(rBtn) rBtn.onclick = async () => { this.c.classList.remove('act'); await App.reload(id, triggerWrapper, context); };
            this.c.classList.add('act');
        }

        render(p, id, context) {
            if (p.querySelector('.tb-wrapper')) return;

            const wrapper = document.createElement('span');
            wrapper.className = 'tb-wrapper';
            wrapper.dataset.id = id;
            wrapper.dataset.ctx = JSON.stringify(context);

            const openReport = async (e) => {
                e.preventDefault(); e.stopPropagation();
                const currentCtx = JSON.parse(wrapper.dataset.ctx || '{}');
                if (wrapper.dataset.res) {
                    this.show(JSON.parse(wrapper.dataset.res), id, wrapper, currentCtx);
                } else {
                    this.load(wrapper);
                    App.observer.unobserve(wrapper);
                    await App.run(id, wrapper, currentCtx, true);
                }
            };

            const badge = document.createElement('span');
            badge.className = 'tb-badge tb-queue';
            badge.innerText = '';
            badge.title = 'クリックで優先的に解析を開始します';
            badge.onclick = openReport;

            const ctxContainer = document.createElement('span');
            ctxContainer.className = 'tb-tags-container';
            ctxContainer.onclick = openReport;

            if (context.isVine) {
                const v = document.createElement('span');
                v.className = 'tb-ctx-mini tb-ctx-vine';
                v.innerText = CONFIG.TEXT.CONTEXT.VINE.label;
                ctxContainer.appendChild(v);
            }

            const algoContainer = document.createElement('span');
            algoContainer.className = 'tb-tags-container tb-algo-tags';
            algoContainer.onclick = openReport;

            const reloadBtn = document.createElement('span');
            reloadBtn.className = 'tb-reload-mini';
            reloadBtn.innerText = '↺';
            reloadBtn.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                await App.reload(id, wrapper, context);
            };

            wrapper.appendChild(badge);
            wrapper.appendChild(ctxContainer);
            wrapper.appendChild(algoContainer);
            wrapper.appendChild(reloadBtn);

            p.appendChild(wrapper);
            App.observer.observe(wrapper);
        }

        upd(wrapper, d, context) {
            wrapper.dataset.res = JSON.stringify(d);
            const badge = wrapper.querySelector('.tb-badge');
            const algoContainer = wrapper.querySelector('.tb-algo-tags');
            const reloadBtn = wrapper.querySelector('.tb-reload-mini');

            // 余白問題を解決するため、ラッパーの親（リストアイテム自体）を探す
            // data-hook="review" が付いている要素がリストのルート要素であることが多い
            const reviewContainer = wrapper.closest('[data-hook="review"]') || wrapper.closest('.review, .review-card, .celwidget');

            if (reloadBtn) {
                reloadBtn.classList.remove('spinning');
                reloadBtn.classList.add('act');
            }

            if (d.err) {
                if (reviewContainer) reviewContainer.setAttribute('data-tb-grade', 'ERR');
                if (d.err.type === 'HIDDEN') {
                    badge.className = 'tb-badge';
                    badge.style.background = '#f3f4f6';
                    badge.style.color = '#4b5563';
                    badge.style.borderColor = '#d1d5db';
                    badge.innerText = '🔒 非表示';
                    badge.title = '詳細レポートを表示';
                } else {
                    badge.className = 'tb-badge tb-error';
                    badge.innerText = '!';
                    badge.title = 'エラーが発生しました';
                }
            } else if (d.sc) {
                let val = d.sc.val;

                if (!context.isVP) {
                    if (context.isVine) val += CONFIG.SCORING.CONTEXT_PENALTY.VINE;
                    else val += CONFIG.SCORING.CONTEXT_PENALTY.NON_VP;
                }

                val = Math.min(100, Math.max(0, val));
                const grd = Scorer.getGrade(val);

                // 親コンテナにグレードを設定（CSSでフィルタリングするため）
                if (reviewContainer) reviewContainer.setAttribute('data-tb-grade', grd);

                badge.className = `tb-badge tb-grade-${grd}`;
                badge.innerHTML = `${grd} ${val}`;
                badge.title = 'クリックで詳細レポートを表示';

                const tags = this.translateTags(d.sc.why);

                // ▼ Context Tag Injection ▼
                let ctxConf = null;

                if (context.isVine) {
                    ctxConf = null;
                } else if (!context.isVP) {
                    ctxConf = CONFIG.TEXT.CONTEXT.NON;
                }

                if (ctxConf) {
                    tags.unshift({
                        key: 'CTX',
                        label: ctxConf.label,
                        desc: ctxConf.desc,
                        style: `background:${ctxConf.color};border-color:${ctxConf.border};color:${ctxConf.text}`
                    });
                }

                algoContainer.innerHTML = tags.map(t =>
                    `<span class="tb-tag-inline" style="${t.style}" title="${t.label}">${t.label}</span>`
                ).join('');
            }
        }

        load(wrapper) {
            const badge = wrapper.querySelector('.tb-badge');
            const reloadBtn = wrapper.querySelector('.tb-reload-mini');
            if (badge) {
                badge.className = 'tb-badge tb-loading';
                badge.innerText = '';
                badge.style.background = '';
                badge.style.color = '';
                badge.style.borderColor = '';
                badge.title = 'クリックで優先的に解析を開始します';
            }
            if (reloadBtn) {
                reloadBtn.classList.add('spinning');
            }
        }
    }

    // =============================================================================
    // 7. Infinite Scroll Manager
    // =============================================================================
    const IS_CONFIG = {
        TRIGGER_DISTANCE: 1500,
        LIST_ID: 'cm_cr-review_list',
        ARCHIVE_ID: 'amz-scroll-review-archive',
        ARCHIVE_LIST_CLASS: 'a-unordered-list a-nostyle a-vertical',

        SHOW_MORE_SELECTOR: '#cm_cr-pagination_bar a[data-hook="show-more-button"]',

        NEXT_BTN_SELECTOR: [
            '#cm_cr-pagination_bar a[data-hook="show-more-button"]',
            '#cm_cr-pagination_bar li.a-last a',
            '#cm_cr-pagination_bar .a-pagination li.a-last a',
            '#cm_cr-pagination_bar a[rel="next"]',
            '#cm_cr-pagination_bar a[aria-label*="次"]',
            '#cm_cr-pagination_bar a[aria-label*="Next"]',
            '.a-pagination li.a-last a',
            '.a-pagination a[rel="next"]'
        ].join(', '),

        HEADER_SELECTOR: '[data-hook="arp-local-reviews-header"]'
    };

    const IS_State = {
        enabled: true, // Master Switch
        isLoading: false,
        scrollLockId: null,
        targetScrollY: 0,
        nativeScrollTo: window.scrollTo,
        observer: null,
        heartbeat: null,

        loadSeq: 0,
        loadTimeoutId: null,
        loadCompleteTimerId: null
    };

    const IS_Debug = {
        enabled: true,
        seq: 0,
        lastMetricLogAt: 0,

        snapshot(extra = {}) {
            const list = document.getElementById(IS_CONFIG.LIST_ID);
            const archive = document.getElementById(IS_CONFIG.ARCHIVE_ID);
            const nextBtn = document.querySelector(IS_CONFIG.NEXT_BTN_SELECTOR);
            const paginationBar = document.getElementById('cm_cr-pagination_bar');
            const anyPagination = document.querySelector('.a-pagination');

            const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
            const windowHeight = window.innerHeight || 0;
            const docHeight = document.documentElement.scrollHeight || 0;
            const scrollBottom = docHeight - (scrollTop + windowHeight);

            return {
                href: location.href,
                enabled: IS_State.enabled,
                isLoading: IS_State.isLoading,
                scrollTop: Math.round(scrollTop),
                windowHeight,
                docHeight,
                scrollBottom: Math.round(scrollBottom),

                listFound: !!list,
                listChildren: list ? list.children.length : 0,
                listReviews: list ? list.querySelectorAll('li[data-hook="review"], div.review').length : 0,

                archiveFound: !!archive,
                archiveReviews: archive ? archive.querySelectorAll('li[data-hook="review"], div.review').length : 0,

                paginationBarFound: !!paginationBar,
                anyPaginationFound: !!anyPagination,

                nextFound: !!nextBtn,
                nextHref: nextBtn ? nextBtn.href : null,
                nextText: nextBtn ? nextBtn.textContent.trim() : null,
                nextOuterHTML: nextBtn ? nextBtn.outerHTML.slice(0, 300) : null,

                ...extra
            };
        },

        log(event, data = {}) {
            if (!this.enabled) return;
            const id = String(++this.seq).padStart(3, '0');
            console.log(`[TB-IS ${id}] ${event}`, data);
        },

        warn(event, data = {}) {
            if (!this.enabled) return;
            const id = String(++this.seq).padStart(3, '0');
            console.warn(`[TB-IS ${id}] ${event}`, data);
        },

        error(event, data = {}) {
            if (!this.enabled) return;
            const id = String(++this.seq).padStart(3, '0');
            console.error(`[TB-IS ${id}] ${event}`, data);
        },

        metric(reason) {
            if (!this.enabled) return;
            const now = Date.now();
            const snap = this.snapshot({ reason });
            if (snap.scrollBottom < IS_CONFIG.TRIGGER_DISTANCE + 300 || now - this.lastMetricLogAt > 3000) {
                this.lastMetricLogAt = now;
                this.log('metric', snap);
            }
        },

        dumpPagination() {
            const paginationBar = document.getElementById('cm_cr-pagination_bar');
            const paginations = Array.from(document.querySelectorAll('.a-pagination'));
            const anchors = Array.from(document.querySelectorAll(
                'a[data-hook="show-more-button"], a[href*="pageNumber="], a[aria-label*="次"], a[aria-label*="Next"], a[rel="next"]'
            ));

            this.log('dumpPagination', {
                url: location.href,
                title: document.title,

                paginationBarOuterHTML: paginationBar ? paginationBar.outerHTML.slice(0, 3000) : null,

                paginationBlocks: paginations.map((el, i) => ({
                    index: i,
                    outerHTML: el.outerHTML.slice(0, 2000)
                })),

                candidateAnchors: anchors.map((a, i) => ({
                    index: i,
                    text: a.textContent.trim(),
                    ariaLabel: a.getAttribute('aria-label'),
                    rel: a.getAttribute('rel'),
                    href: a.href,
                    dataHook: a.getAttribute('data-hook'),
                    className: a.className,
                    outerHTML: a.outerHTML.slice(0, 500)
                }))
            });
        }
    };

    const IS_UI = {
        setupArchive: () => {
            IS_Debug.log('setupArchive:begin', IS_Debug.snapshot());

            const list = document.getElementById(IS_CONFIG.LIST_ID);
            if (!list) {
                IS_Debug.warn('setupArchive:no_list', IS_Debug.snapshot());
                return;
            }
            if (document.getElementById(IS_CONFIG.ARCHIVE_ID)) {
                IS_Debug.log('setupArchive:already_exists', IS_Debug.snapshot());
                return;
            }

            const archive = document.createElement('div');
            archive.id = IS_CONFIG.ARCHIVE_ID;
            const ul = document.createElement('ul');
            ul.className = IS_CONFIG.ARCHIVE_LIST_CLASS;
            ul.id = 'amz-scroll-internal-list';
            archive.appendChild(ul);
            list.parentNode.insertBefore(archive, list);

            IS_Debug.log('setupArchive:done', IS_Debug.snapshot());
        },

        destroyArchive: () => {
            const loader = document.getElementById('amz-scroll-native-loader');
            if (loader) loader.remove();
            IS_Debug.log('destroyArchive', IS_Debug.snapshot());
        },

        cleanUpHeaders: () => {
            const headers = document.querySelectorAll(IS_CONFIG.HEADER_SELECTOR);
            if (headers.length > 1) {
                for (let i = 1; i < headers.length; i++) headers[i].remove();
            }
            IS_Debug.log('cleanUpHeaders', { headerCount: headers.length });
        },

        moveToArchive: () => {
            const list = document.getElementById(IS_CONFIG.LIST_ID);
            const archive = document.getElementById(IS_CONFIG.ARCHIVE_ID);
            const internalUl = document.getElementById('amz-scroll-internal-list');

            if (!list || !archive || !internalUl) {
                IS_Debug.warn('moveToArchive:missing_target', IS_Debug.snapshot());
                return;
            }

            IS_UI.cleanUpHeaders();

            const header = document.querySelector(IS_CONFIG.HEADER_SELECTOR);
            if (header && !archive.contains(header)) archive.insertBefore(header, internalUl);

            let reviews = list.querySelectorAll('li[data-hook="review"]');
            if (reviews.length === 0) reviews = list.querySelectorAll('div.review');

            const moved = reviews.length;
            reviews.forEach(review => {
                review.classList.add('a-spacing-large');
                internalUl.appendChild(review);
            });

            IS_Debug.log('moveToArchive:done', IS_Debug.snapshot({ moved }));
        },

        createLoader: () => {
            const list = document.getElementById(IS_CONFIG.LIST_ID);
            const old = document.getElementById('amz-scroll-native-loader');
            if (old) old.remove();

            if (!list) {
                IS_Debug.warn('createLoader:no_list', IS_Debug.snapshot());
                return;
            }

            const loader = document.createElement('div');
            loader.id = 'amz-scroll-native-loader';
            loader.style.cssText = 'text-align: center; padding: 20px; background: #fff; color: #777; font-size: 13px; border-radius: 4px; margin: 12px 0 20px; clear: both;';
            loader.innerHTML = '<span class="a-spinner-medium"></span> 次のレビューを読み込んでいます...';

            list.insertAdjacentElement('afterend', loader);

            IS_Debug.log('createLoader:done', IS_Debug.snapshot());
        }
    };

    const IS_Helper = {
        isShowMoreMode() {
            return !!document.querySelector(IS_CONFIG.SHOW_MORE_SELECTOR);
        },

        safeClick(el) {
            if (!el) return false;

            try {
                if (typeof el.click === 'function') {
                    el.click();
                    return true;
                }
            } catch (e) {
                console.warn('TrustBadge: native click failed', e);
            }

            try {
                el.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true
                }));
                return true;
            } catch (e) {
                console.warn('TrustBadge: dispatchEvent click failed', e);
            }

            return false;
        },

        clearLoadTimers() {
            if (IS_State.loadTimeoutId) {
                clearTimeout(IS_State.loadTimeoutId);
                IS_State.loadTimeoutId = null;
            }
            if (IS_State.loadCompleteTimerId) {
                clearTimeout(IS_State.loadCompleteTimerId);
                IS_State.loadCompleteTimerId = null;
            }
        },

        resetLoading(reason = 'unknown', seq = null) {
            if (seq !== null && seq !== IS_State.loadSeq) {
                IS_Debug.log('resetLoading:stale_skip', {
                    reason,
                    seq,
                    currentSeq: IS_State.loadSeq
                });
                return;
            }

            IS_Debug.warn('resetLoading', { reason, seq, snap: IS_Debug.snapshot() });

            this.clearLoadTimers();

            IS_State.isLoading = false;
            IS_Logic.stopGravityAnchor?.();

            const loader = document.getElementById('amz-scroll-native-loader');
            if (loader) loader.remove();
        }
    };

    const IS_Logic = {
        toggle(enable) {
            IS_Debug.log('toggle', { enable });
            IS_State.enabled = enable;

            if (enable) document.body.classList.add('tb-is-active');
            else document.body.classList.remove('tb-is-active');

            if (enable) {
                if (!IS_Helper.isShowMoreMode() && !document.getElementById(IS_CONFIG.ARCHIVE_ID)) {
                    IS_UI.setupArchive();
                }

                this.startMainListObserver();

                if (!IS_State.heartbeat) {
                    IS_State.heartbeat = setInterval(() => this.checkTrigger(), 2000);
                    IS_Debug.log('heartbeat:start', { intervalMs: 2000 });
                }

                setTimeout(() => this.checkTrigger(), 100);
            } else {
                this.disconnect();
                if (IS_State.heartbeat) {
                    clearInterval(IS_State.heartbeat);
                    IS_State.heartbeat = null;
                    IS_Debug.log('heartbeat:stop');
                }
                IS_Helper.resetLoading('toggle_off');
            }
        },

        disconnect() {
            if (IS_State.observer) {
                IS_State.observer.disconnect();
                IS_State.observer = null;
                IS_Debug.log('observer:disconnect');
            }
        },

        checkTrigger() {
            if (!IS_State.enabled) {
                IS_Debug.metric('checkTrigger:disabled');
                return;
            }
            if (IS_State.isLoading) {
                IS_Debug.metric('checkTrigger:loading');
                return;
            }

            const snap = IS_Debug.snapshot({ reason: 'checkTrigger' });

            if (snap.scrollBottom < IS_CONFIG.TRIGGER_DISTANCE) {
                IS_Debug.log('checkTrigger:threshold_hit', snap);
                this.clickNextPage();
            } else {
                IS_Debug.metric('checkTrigger:waiting');
            }
        },

        startMainListObserver: () => {
            if (!IS_State.enabled) {
                IS_Debug.warn('observer:start_skipped_disabled');
                return;
            }

            const list = document.getElementById(IS_CONFIG.LIST_ID);
            if (!list) {
                IS_Debug.warn('observer:no_list', IS_Debug.snapshot());
                return;
            }

            if (IS_State.observer) IS_State.observer.disconnect();

            IS_Debug.log('observer:start', IS_Debug.snapshot());

            IS_State.observer = new MutationObserver((mutations) => {
                if (!IS_State.enabled) return;

                const summary = mutations.map(m => ({
                    type: m.type,
                    added: m.addedNodes.length,
                    removed: m.removedNodes.length
                }));

                let nodesAdded = false;
                for (const mutation of mutations) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        const hasElement = Array.from(mutation.addedNodes).some(node => node.nodeType === 1);
                        if (hasElement) {
                            nodesAdded = true;
                            break;
                        }
                    }
                }

                if (nodesAdded) {
                    IS_Debug.log('observer:mutation_detected', {
                        summary,
                        snap: IS_Debug.snapshot()
                    });

                    if (IS_State.isLoading) {
                        const seq = IS_State.loadSeq;

                        if (IS_State.loadCompleteTimerId) {
                            clearTimeout(IS_State.loadCompleteTimerId);
                        }

                        IS_State.loadCompleteTimerId = setTimeout(() => {
                            if (seq !== IS_State.loadSeq) {
                                IS_Debug.log('observer:load_complete_stale_skip', {
                                    seq,
                                    currentSeq: IS_State.loadSeq
                                });
                                return;
                            }

                            IS_Debug.log('observer:load_complete_before_reset', IS_Debug.snapshot({ seq }));

                            IS_Helper.clearLoadTimers();
                            IS_State.isLoading = false;

                            const loader = document.getElementById('amz-scroll-native-loader');
                            if (loader) loader.remove();

                            IS_Logic.stopGravityAnchor();
                            IS_UI.cleanUpHeaders();

                            IS_Debug.log('observer:load_complete_after_reset', IS_Debug.snapshot({ seq }));

                            setTimeout(() => IS_Logic.checkTrigger(), 500);
                        }, 800);
                    } else {
                        if (!IS_Helper.isShowMoreMode()) {
                            const archive = document.getElementById(IS_CONFIG.ARCHIVE_ID);
                            if (archive) archive.remove();
                            IS_UI.setupArchive();
                            setTimeout(IS_UI.cleanUpHeaders, 100);

                            IS_Debug.log('observer:mutation_non_loading_reset', IS_Debug.snapshot());
                        } else {
                            IS_Debug.log('observer:mutation_non_loading_ignore_show_more', IS_Debug.snapshot());
                        }
                    }
                }
            });

            IS_State.observer.observe(list, { childList: true, subtree: true });
        },

        startGravityAnchor: () => {
            if (IS_State.scrollLockId) {
                IS_Debug.warn('gravity:start_skipped_already_running');
                return;
            }

            IS_State.targetScrollY = window.scrollY || document.documentElement.scrollTop;
            IS_Debug.log('gravity:start', { targetScrollY: IS_State.targetScrollY });

            const lockLoop = () => {
                IS_State.nativeScrollTo.call(window, 0, IS_State.targetScrollY);
                IS_State.scrollLockId = requestAnimationFrame(lockLoop);
            };
            IS_State.scrollLockId = requestAnimationFrame(lockLoop);
        },

        stopGravityAnchor: () => {
            if (IS_State.scrollLockId) {
                cancelAnimationFrame(IS_State.scrollLockId);
                IS_State.scrollLockId = null;
                IS_Debug.log('gravity:stop');
            }
        },

        clickNextPage: () => {
            const pre = IS_Debug.snapshot({ reason: 'clickNextPage:before' });

            if (!IS_State.enabled) {
                IS_Debug.warn('clickNextPage:disabled', pre);
                return;
            }
            if (IS_State.isLoading) {
                IS_Debug.warn('clickNextPage:already_loading', pre);
                return;
            }

            // ------------------------------------------------------------
            // A. Amazonの新UI: 「さらに10件のレビューを表示」方式
            // ------------------------------------------------------------
            const showMoreBtn = document.querySelector(IS_CONFIG.SHOW_MORE_SELECTOR);
            if (showMoreBtn) {
                const showMoreDisabled = !!(
                    showMoreBtn.getAttribute('aria-disabled') === 'true' ||
                    showMoreBtn.closest('.a-button')?.classList.contains('a-button-disabled')
                );

                if (showMoreDisabled) {
                    IS_Debug.warn('clickNextPage:show_more_disabled', pre);
                    return;
                }

                IS_State.isLoading = true;
                IS_State.loadSeq += 1;
                const seq = IS_State.loadSeq;
                IS_Helper.clearLoadTimers();

                IS_Debug.log('clickNextPage:show_more_click', IS_Debug.snapshot({
                    seq,
                    buttonText: showMoreBtn.textContent.trim(),
                    buttonHref: showMoreBtn.href,
                    stateParam: showMoreBtn.getAttribute('data-reviews-state-param')
                }));

                IS_UI.createLoader();

                const clicked = IS_Helper.safeClick(showMoreBtn);
                if (!clicked) {
                    IS_Helper.resetLoading('show_more_click_failed', seq);
                    return;
                }

                setTimeout(() => {
                    if (seq !== IS_State.loadSeq) return;
                    IS_Debug.log('clickNextPage:show_more_after_1s', IS_Debug.snapshot({ seq }));
                }, 1000);

                setTimeout(() => {
                    if (seq !== IS_State.loadSeq) return;
                    IS_Debug.log('clickNextPage:show_more_after_3s', IS_Debug.snapshot({ seq }));
                }, 3000);

                IS_State.loadTimeoutId = setTimeout(() => {
                    if (IS_State.isLoading && seq === IS_State.loadSeq) {
                        IS_Helper.resetLoading('show_more_timeout', seq);
                    }
                }, 10000);

                return;
            }

            // ------------------------------------------------------------
            // B. 旧UI/従来ページネーション fallback
            // ------------------------------------------------------------
            let nextBtn = document.querySelector(IS_CONFIG.NEXT_BTN_SELECTOR);

            if (!nextBtn) {
                const paginationBar = document.getElementById('cm_cr-pagination_bar');
                if (paginationBar) {
                    nextBtn = paginationBar.querySelector(
                        'a[rel="next"], a[aria-label*="次"], a[aria-label*="Next"], a[href*="pageNumber="]'
                    );
                }
            }

            if (!nextBtn) {
                IS_Debug.dumpPagination();
                IS_Debug.error('clickNextPage:no_next_btn', pre);
                return;
            }

            const nextLi = nextBtn.closest('li');
            const disabled = !!(
                nextBtn.getAttribute('aria-disabled') === 'true' ||
                nextLi?.classList.contains('a-disabled') ||
                nextLi?.getAttribute('aria-disabled') === 'true'
            );

            if (disabled) {
                IS_Debug.warn('clickNextPage:next_disabled', pre);
                return;
            }

            IS_State.isLoading = true;

            IS_Debug.log('clickNextPage:clicking', IS_Debug.snapshot({
                nextHref: nextBtn.href,
                nextText: nextBtn.textContent.trim()
            }));

            // 従来ページネーション時のみ archive 退避
            IS_Logic.startGravityAnchor();
            IS_UI.moveToArchive();
            IS_UI.createLoader();

            const clicked = IS_Helper.safeClick(nextBtn);
            if (!clicked) {
                IS_Helper.resetLoading('next_click_failed');
                return;
            }

            setTimeout(() => {
                IS_Debug.log('clickNextPage:after_1s', IS_Debug.snapshot());
            }, 1000);

            setTimeout(() => {
                IS_Debug.log('clickNextPage:after_3s', IS_Debug.snapshot());
            }, 3000);

            setTimeout(() => {
                if (IS_State.isLoading) {
                    IS_Helper.resetLoading('next_timeout');
                }
            }, 10000);
        }
    };

    const initInfiniteScroll = () => {
        IS_Debug.log('initInfiniteScroll:start', { href: location.href });

        if (!location.href.match(/\/product-reviews\//)) {
            IS_Debug.warn('initInfiniteScroll:skip_not_review_page', { href: location.href });
            return;
        }

        window.TBIS = {
            snapshot: () => IS_Debug.snapshot(),
            check: () => IS_Logic.checkTrigger(),
            next: () => IS_Logic.clickNextPage(),
            state: IS_State
        };

        window.addEventListener('beforeunload', () => {
            IS_Debug.warn('window:beforeunload', { href: location.href });
        });

        window.addEventListener('pageshow', () => {
            IS_Debug.log('window:pageshow', { href: location.href });
        });

        if (!document.getElementById('amz-scroll-style')) {
            const style = document.createElement('style');
            style.id = 'amz-scroll-style';
            style.textContent = `
                body.tb-is-active #cm_cr-pagination_bar { opacity: 0; height: 1px; overflow: hidden; pointer-events: none; }
                #amz-scroll-review-archive { margin-bottom: 0; padding: 0; }
                #cm_cr-review_list li[data-hook="review"],
                #amz-scroll-review-archive li[data-hook="review"] { list-style: none !important; margin-left: 0 !important; padding-left: 0 !important; }
                [data-hook="arp-local-reviews-header"] { margin-top: 20px; margin-bottom: 10px; font-weight: bold; font-size: 18px; }
                [data-hook="arp-local-reviews-header"] ~ [data-hook="arp-local-reviews-header"] { display: none !important; }
            `;
            document.head.appendChild(style);
        }

        if (!IS_Helper.isShowMoreMode()) {
            IS_UI.setupArchive();
        }

        window.addEventListener('scroll', () => {
            IS_Logic.checkTrigger();
        });

        window.addEventListener('resize', () => {
            IS_Logic.checkTrigger();
        });

        setTimeout(() => {
            IS_Debug.log('initInfiniteScroll:ready', IS_Debug.snapshot());
        }, 1000);
    };

    // =============================================================================
    // 8. Main App
    // =============================================================================
    const App = {
        ui: new UIManager(),
        observer: null,

        init() {
            // FilterManagerを初期化
            FilterManager.init();

            initInfiniteScroll();

            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const el = entry.target;
                        const id = el.dataset.id;
                        const ctx = JSON.parse(el.dataset.ctx || '{}');
                        this.observer.unobserve(el);
                        this.checkCacheAndRun(id, el, ctx);
                    }
                });
            }, { rootMargin: '50px' });

            let debounceTimer;
            const obs = new MutationObserver(m => {
                if (m.some(x => x.addedNodes.length)) {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => this.scan(), 500);
                }
            });
            obs.observe(document.body, { childList: true, subtree: true });

            this.scan();
        },

        scan() {
            // モーダル対応のセレクタを含めて取得（レビューリスト、カード、ウィジェット、モーダル）
            const selector = '.review .a-profile, .review-card .a-profile, .celwidget .a-profile, [data-hook="genome-widget"] .a-profile, [data-reviewbind="ProfileBlock"] .a-profile';
            const profiles = document.querySelectorAll(selector);

            profiles.forEach(p => {
                // 既に処理済み(tb=1)ならスキップ
                if (p.dataset.tb === '1') return;

                // hrefがない、または "javascript" で始まる（ロード前/無効）場合は
                // 処理済みにせずスキップ（後で有効なリンクになった時に再検知させるため）
                if (!p.href || p.href.includes('javascript')) return;

                // URLからユーザーID抽出
                const m = p.href.match(/amzn1\.account\.[A-Z0-9]+/);

                if (m) {
                    // IDが見つかった場合のみ「処理済み」としてマーク
                    p.dataset.tb = '1';

                    const name = p.querySelector('.a-profile-name');
                    if (name) {
                        // ---------------------------------------------------------
                        // 1. コンテナ探索 (Desktop / Mobile / Modal 対応)
                        // ---------------------------------------------------------
                        let reviewContainer = p.closest('div.review, li.review, div.review-card');

                        // Mobile対応: プロフィールと本文が兄弟要素の場合
                        if (!reviewContainer) {
                            reviewContainer = p.closest('[data-hook="mobley-review-content"]');
                        }

                        // Modal対応: サイドパネル全体をコンテナとみなす
                        if (!reviewContainer) {
                            reviewContainer = p.closest('.a-section') || p.closest('[data-reviewbind="ProfileBlock"]')?.parentElement;
                        }

                        // 最終手段: リストアイテムやWidget全体
                        if (!reviewContainer) {
                            reviewContainer = p.closest('li[role="listitem"]') || p.closest('.celwidget');
                        }

                        // コンテナが見つからなければ解析不能なのでスキップ
                        if (!reviewContainer) return;

                        // ---------------------------------------------------------
                        // 2. 判定ロジック (DOM属性 & テキスト検索)
                        // ---------------------------------------------------------
                        let isVine = false;
                        let isVP = false;

                        // --- A. Amazonで購入 (VP) 判定 ---
                        // 優先度1: バッジフック (Desktop/Mobile)
                        if (reviewContainer.querySelector('span[data-hook*="avp-badge"]')) {
                            isVP = true;
                        }
                        // 優先度2: フォーマットストリップ内のテキスト
                        else if ((reviewContainer.querySelector('.review-format-strip')?.textContent || '').includes('Amazonで購入')) {
                            isVP = true;
                        }
                        // 優先度3: 特定クラスのテキスト (Mobile等)
                        else if (reviewContainer.querySelector('.a-color-state.a-text-bold')?.textContent.trim() === 'Amazonで購入') {
                            isVP = true;
                        }
                        // 優先度4: モーダル専用バッジ (data-reviewbind内)
                        else {
                            const modalBadge = reviewContainer.querySelector('[data-reviewbind="ProfileBadge"]');
                            if (modalBadge && modalBadge.textContent.includes('Amazonで購入')) {
                                isVP = true;
                            }
                        }

                        // --- B. Vine (無償提供) 判定 ---
                        const vineBadgeElement = reviewContainer.querySelector('.a-color-success');
                        // 緑色のテキストで "Vine" または "無料" を含むかチェック
                        if (vineBadgeElement && (vineBadgeElement.textContent.includes('Vine') || vineBadgeElement.textContent.includes('無料'))) {
                            isVine = true;
                        } else {
                            // コンテナ全体のテキストから判定 (ヘッダー付近にあることを期待)
                            const fullText = reviewContainer.textContent;
                            if (fullText.includes('Vine先取り') || fullText.includes('Vine Customer Review')) {
                                isVine = true;
                            }
                        }

                        // ---------------------------------------------------------
                        // 3. UI描画
                        // ---------------------------------------------------------
                        const userName = name.textContent.trim();
                        const imgNode = p.querySelector('.a-profile-avatar img');

                        // プレースホルダー画像(grey-pixel)を除外し、実画像を優先取得
                        let rawImg = (imgNode && (imgNode.getAttribute('data-src') || imgNode.getAttribute('src'))) || '';
                        if (rawImg.includes('grey-pixel')) rawImg = '';

                        const userImg = rawImg || 'https://images-fe.ssl-images-amazon.com/images/S/amazon-avatars-global/default._CR0,0,1024,1024_SX48_.png';

                        this.ui.render(name.parentNode, m[0], { isVine, isVP, name: userName, avatar: userImg });
                    }
                }
            });
        },

        async checkCacheAndRun(id, wrapper, context) {
            const c = await CacheManager.get(id);
            if (c) {
                this.ui.upd(wrapper, c, context);
            } else {
                await this.run(id, wrapper, context);
            }
        },

        async reload(id, wrapper, context) {
            await CacheManager.remove(id);
            await this.run(id, wrapper, context, true);
        },

        async run(id, wrapper, context, priority = false) {
            this.ui.load(wrapper);
            try {
                let url = `https://www.amazon.co.jp/gp/profile/${id}`;
                let html = await NetworkManager.fetch(url, priority);
                let res = Parser.parse(html);

                if (res.error === 'NO_DATA') {
                    url = `https://www.amazon.co.jp/gp/profile/${id}/reviews`;
                    html = await NetworkManager.fetch(url, priority);
                    res = Parser.parse(html);
                }

                if (res.error) {
                    const snip = html.substring(html.indexOf('<body'), html.indexOf('<body')+500);
                    const err = { err: { type: res.error, msg: res.error }, htmlPreview: snip };
                    await CacheManager.set(id, err, 'FAIL');
                    this.ui.upd(wrapper, err, context);
                    return;
                }

                const analysis = Scorer.analyze(res.reviews, res.meta.globalImageCount);
                if (!analysis || !analysis.score) throw new Error("Scoring Failed");

                const data = {
                    src: { url, type: res.meta.strategy, globalImageCount: res.meta.globalImageCount },
                    st: analysis.stats, sc: analysis.score
                };

                await CacheManager.set(id, data, 'SUCCESS');
                this.ui.upd(wrapper, data, context);

            } catch (e) {
                console.error(e);
                const err = { err: { type: 'SYS', msg: e.message } };
                this.ui.upd(wrapper, err, context);
            }
        }
    };

    App.init();
    GM.registerMenuCommand("キャッシュを全削除", async () => {
        (await GM.listValues()).filter(k=>k.startsWith('tr4:')).forEach(k=>GM.deleteValue(k));
        alert('キャッシュを削除しました');
    });
})();
