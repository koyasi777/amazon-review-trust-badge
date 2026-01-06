// ==UserScript==
// @name         Amazon Reviewer Trust Badge (Quality Check & Fake Detector)
// @name:ja      Amazonレビュー信頼度判定バッジ (サクラ識別 & 品質チェック)
// @namespace    https://github.com/koyasi777/amazon-review-trust-badge
// @version      1.0.0
// @description  Visualizes the reliability of Amazon reviewers based on their review history. Detects suspicious behavior, bias, and low-quality reviews with a detailed trust score badge.
// @description:ja Amazonのレビュアーの投稿履歴を分析し、信頼度を視覚化します。サクラやバイアス、低品質なレビューを検出し、S〜Dのランクでバッジ表示。詳細レポートで評価の偏りや文字数、写真投稿率などを確認できます。
// @author       koyasi777
// @license      MIT
// @match        https://www.amazon.co.jp/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=amazon.co.jp
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
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // =============================================================================
    // 0. Configuration
    // =============================================================================
    const CONFIG = {
        APP_NAME: 'TrustBadge',
        VERSION: '4.0.5',
        CACHE: { PREFIX: 'tr4:', TTL_SUCCESS: 604800000, TTL_FAIL: 86400000 },
        NETWORK: {
            MIN_INTERVAL: 2500,
            JITTER: 1500,
            TIMEOUT: 15000,
            LOCK_DURATION: 15 * 60 * 1000
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
        static processing = false;
        static circuitOpen = false;

        static async fetch(url) {
            if (this.circuitOpen) throw new Error('CIRCUIT_OPEN: Emergency Lock');
            const lockUntil = await GM.getValue('emergency_lock', 0);
            if (Date.now() < lockUntil) {
                this.circuitOpen = true;
                throw new Error(`Locked until ${new Date(lockUntil).toLocaleTimeString()}`);
            }
            return new Promise((resolve, reject) => {
                this.queue.push({ url, resolve, reject });
                this.processQueue();
            });
        }

        static async processQueue() {
            if (this.processing || this.queue.length === 0) return;
            this.processing = true;
            const { url, resolve, reject } = this.queue.shift();
            try {
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
                this.processing = false;
                if (this.queue.length > 0) this.processQueue();
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
            console.error('⚠️ AMAZON ROBOT DETECTED: Opening Circuit Breaker.');
            this.circuitOpen = true;
            const lockUntil = Date.now() + CONFIG.NETWORK.LOCK_DURATION;
            await GM.setValue('emergency_lock', lockUntil);
            this.queue.forEach(q => q.reject(new Error('CIRCUIT_OPEN_ABORT')));
            this.queue = [];
        }
    }

    // =============================================================================
    // 3. Parser (Modified for Hidden Reviews)
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
    // 4. Scorer (Optimized for v4.0.5)
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

            // ▼▼▼ Gold判定用変数 ▼▼▼
            let goldHelpfulSum = 0;
            let goldReviewCnt = 0;

            // ▼▼▼ ギャップ検知用の配列 ▼▼▼
            const targetReviews = []; // ★5
            const camoReviews = [];   // ★2-4

            reviews.forEach(r => {
                const s = (typeof r.star === 'number') ? r.star : 3;
                stats.sDist[s]++; sumS+=s;

                // グルーピング
                if (s === 5) targetReviews.push(r);
                else if (s >= 2 && s <= 4) camoReviews.push(r);

                const len = r.len || 0;
                sumL += len;
                if (len < 20) shortLenCnt++;

                if(r.hasImage) imgC++;
                const h = r.helpful || 0;
                sumHelpful += h;

                if (!r.hasImage && len < 40 && h >= 3) suspiciousHelpfulCount++;

                // ▼▼▼ Gold集計ロジック (対象: ★2-4 かつ 150文字超) ▼▼▼
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
            // 修正: 2件以上中間評価があって初めてDiverseとみなす
            stats.flags.diverse = (stats.sDist[2]+stats.sDist[3]+stats.sDist[4]) >= 2;
            stats.flags.thin = (stats.lenAvg > 0 && stats.lenAvg < 40) || (shortLenCnt >= 2);
            stats.flags.swarm = suspiciousHelpfulCount >= 2;

            // ▼▼▼ ギャップ判定ロジック ▼▼▼
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
                // ▼▼▼ Goldボーナス算出ロジック ▼▼▼
                if ((goldReviewCnt > 0 || goldHelpfulSum > 0) && !stats.flags.gap) {
                    const countScore = goldReviewCnt * 1.5;
                    const voteScore = Math.log2(goldHelpfulSum + 1) * 2.0;
                    const goldBonus = Math.min(R.BONUS.GOLD_MAX, Math.round(countScore + voteScore));
                    sc += goldBonus;
                    if (goldBonus >= 3) why.push('Gold');
                }

                // Helpfulボーナス
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
    // 5. UI Manager (Clickable Tags & Reports)
    // =============================================================================
    class UIManager {
        constructor() {
            this.createOverlay();
            const s = document.createElement('style');
            s.textContent = `
                .tb-wrapper { display: inline-flex; align-items: center; gap: 4px; vertical-align: middle; margin-left: 8px; font-family: "Amazon Ember", Arial, sans-serif; line-height:1; }
                .tb-badge { padding: 3.4px 7px; border-radius: 4px; font-size: 11.5px; font-weight: bold; cursor: pointer; border: 1px solid #ccc; background: #f8f8f8; color: #333; user-select: none; transition: all 0.2s; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
                .tb-badge:hover { filter: brightness(0.95); transform: translateY(-1px); }
                .tb-loading { color: #666; animation: tb-pulse 1.5s infinite; cursor: wait; }
                .tb-wait { color: #999; border-style: dashed; }
                .tb-error { background: #fff5f5; border-color: #fc8181; color: #c53030; }
                .tb-grade-S { background: #c6f6d5; border-color: #48bb78; color: #22543d; }
                .tb-grade-A { background: #f0fff4; border-color: #9ae6b4; color: #276749; }
                .tb-grade-B { background: #fffff0; border-color: #fbd38d; color: #744210; }
                .tb-grade-C { background: #fffaf0; border-color: #f6ad55; color: #9c4221; }
                .tb-grade-D { background: #fff5f5; border-color: #fc8181; color: #9b2c2c; }
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
                @keyframes tb-pulse { 0%{opacity:1;} 50%{opacity:0.5;} 100%{opacity:1;} }
                @keyframes tb-spin  { 100% { transform: rotate(360deg); } }
                #tb-pop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; display: none; align-items: center; justify-content: center; }
                #tb-pop.act { display: flex; }
                .tb-win { background: #fff; width: 95%; max-width: 420px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); font-family: "Amazon Ember", sans-serif; position: relative; }
                .tb-head { padding: 12px 16px; background: #f7f7f7; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #333; border-top-left-radius: 8px; border-top-right-radius: 8px; }
                .tb-bod { padding: 20px; font-size: 13px; color: #333; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; }
                .tb-score-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
                .tb-grade-lg { font-size: 32px; font-weight: bold; line-height: 1; }
                .tb-val-lg { font-size: 20px; color: #555; }
                .tb-tag { display: inline-block; background: #eee; padding: 2px 8px; border-radius: 12px; margin: 0 4px 4px 0; font-size: 11px; color: #555; position: relative; cursor: help; }

                /* Tooltip CSS */
                .tb-tag::before {
                    content: attr(data-tooltip);
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%) translateY(-5px);
                    padding: 8px 12px;
                    background: #2d3748;
                    color: #fff;
                    font-size: 11px;
                    line-height: 1.4;
                    border-radius: 4px;
                    white-space: normal;
                    width: max-content;
                    max-width: 240px;
                    text-align: left;
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.2s, transform 0.2s;
                    pointer-events: none;
                    z-index: 10000;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.2);
                    font-weight: normal;
                }
                .tb-tag::after {
                    content: '';
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    margin-bottom: -5px;
                    transform: translateX(-50%) translateY(-5px);
                    border-width: 5px;
                    border-style: solid;
                    border-color: #2d3748 transparent transparent transparent;
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.2s, transform 0.2s;
                    z-index: 10000;
                }
                .tb-tag:hover::before, .tb-tag:hover::after {
                    opacity: 1;
                    visibility: visible;
                    transform: translateX(-50%) translateY(-10px);
                }

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

                this.b.innerHTML = `
                    ${alerts.join('')}
                    <div class="tb-score-row">
                        <span class="tb-grade-lg tb-grade-${finalGrade}" style="padding:4px 12px;border-radius:4px;border:1px solid currentcolor">${finalGrade}</span>
                        <span class="tb-val-lg">${finalVal}<small>/100</small></span>
                    </div>
                    ${unc ? `<div style="margin-bottom:10px">${unc}</div>` : ''}
                    <div>
                        ${tags.map(t => `<span class="tb-tag" style="${t.style}" data-tooltip="${t.desc}">${t.label}</span>`).join('')}
                    </div>
                    <div class="tb-grid">
                        <div class="tb-item"><span class="tb-label">${L.CNT}</span><span class="tb-data">${st.cnt}件</span></div>
                        <div class="tb-item"><span class="tb-label">${L.LEN}</span><span class="tb-data">${Math.round(st.lenAvg)}文字</span></div>
                        <div class="tb-item"><span class="tb-label">${L.IMG}</span><span class="tb-data">${Math.round(st.imgR*100)}%</span></div>
                        <div class="tb-item"><span class="tb-label">${L.HELPFUL}</span><span class="tb-data">${Math.round(st.avgHelpful*10)/10}</span></div>
                    </div>
                    <div class="tb-meta">
                        <div>Strat: ${src.type}<br>ID: ${id}</div>
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
                if (wrapper.dataset.res) this.show(JSON.parse(wrapper.dataset.res), id, wrapper, currentCtx);
                else {
                    App.observer.unobserve(wrapper);
                    await App.run(id, wrapper, currentCtx);
                }
            };

            const badge = document.createElement('span');
            badge.className = 'tb-badge tb-wait';
            badge.innerText = '⏳';
            badge.title = '信頼度分析詳細を表示';
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

            if (reloadBtn) {
                reloadBtn.classList.remove('spinning');
                reloadBtn.classList.add('act');
            }

            if (d.err) {
                if (d.err.type === 'HIDDEN') {
                    badge.className = 'tb-badge';
                    badge.style.background = '#f3f4f6';
                    badge.style.color = '#4b5563';
                    badge.style.borderColor = '#d1d5db';
                    badge.innerText = '🔒 非表示';
                } else {
                    badge.className = 'tb-badge tb-error';
                    badge.innerText = '!';
                }
            } else if (d.sc) {
                let val = d.sc.val;

                if (!context.isVP) {
                    if (context.isVine) val += CONFIG.SCORING.CONTEXT_PENALTY.VINE;
                    else val += CONFIG.SCORING.CONTEXT_PENALTY.NON_VP;
                }

                val = Math.min(100, Math.max(0, val));
                const grd = Scorer.getGrade(val);

                badge.className = `tb-badge tb-grade-${grd}`;
                badge.innerHTML = `${grd} ${val}`;

                const tags = this.translateTags(d.sc.why);
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
                badge.innerText = '↻';
                badge.style.background = '';
                badge.style.color = '';
                badge.style.borderColor = '';
            }
            if (reloadBtn) {
                reloadBtn.classList.add('spinning');
            }
        }
    }

    // =============================================================================
    // 6. Main App
    // =============================================================================
    const App = {
        ui: new UIManager(),
        observer: null,

        init() {
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

            const obs = new MutationObserver(m => { if(m.some(x=>x.addedNodes.length)) this.scan(); });
            obs.observe(document.body, {childList:true, subtree:true});
            this.scan();
        },

        scan() {
            const profiles = document.querySelectorAll('.review .a-profile, .review-card .a-profile, .celwidget .a-profile');

            profiles.forEach(p => {
                if (p.dataset.tb || !p.href) return;
                p.dataset.tb = '1';

                const m = p.href.match(/amzn1\.account\.[A-Z0-9]+/);
                if (m) {
                    const name = p.querySelector('.a-profile-name');
                    if (name) {
                        const reviewContainer = p.closest('div.review, li.review, div.a-section.celwidget');
                        let isVine = false;
                        let isVP = false;

                        if (reviewContainer) {
                            const vpBadge = reviewContainer.querySelector('span[data-hook^="avp-badge"]');
                            if (vpBadge) {
                                isVP = true;
                            } else {
                                const badgeText = reviewContainer.querySelector('.review-format-strip')?.textContent || '';
                                if (badgeText.includes('Amazonで購入')) isVP = true;
                            }

                            const textContent = reviewContainer.textContent;
                            if (textContent.includes('Vine先取り') || textContent.includes('Vine Customer Review')) isVine = true;
                        }

                        this.ui.render(name.parentNode, m[0], { isVine, isVP });
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
            await this.run(id, wrapper, context);
        },

        async run(id, wrapper, context) {
            this.ui.load(wrapper);
            try {
                let url = `https://www.amazon.co.jp/gp/profile/${id}`;
                let html = await NetworkManager.fetch(url);
                let res = Parser.parse(html);

                if (res.error === 'NO_DATA') {
                    url = `https://www.amazon.co.jp/gp/profile/${id}/reviews`;
                    html = await NetworkManager.fetch(url);
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
