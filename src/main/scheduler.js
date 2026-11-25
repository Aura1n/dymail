'use strict';

/* Sends scheduled drafts that are due. A failed send stays in the list with
   its error, and is retried after a cooldown instead of blocking the queue. */

const RETRY_MS = 5 * 60 * 1000;
const TICK_MS = 30 * 1000;

class Scheduler {
  constructor({ store, mail, onEvent }) {
    this.store = store;
    this.mail = mail;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.timer = null;
    this.kickTimer = null;
    this.bootTimer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      this.tick();
    }, 1500);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.kickTimer) {
      clearTimeout(this.kickTimer);
      this.kickTimer = null;
    }
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
  }

  kick() {
    if (this.timer == null) return;
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      this.tick();
    }, 300);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const due = this.store
        .listScheduled()
        .then((items) =>
          items.filter((item) => {
            const at = Date.parse(item.sendAt);
            return Number.isFinite(at) && at <= now && Number(item.nextAttempt || 0) <= now;
          })
        );
      for (const item of await due) {
        try {
          await this.send(item.id, { manual: false });
        } catch {
          /* send() already recorded the error and scheduled a retry; keep the
             rest of the due queue moving instead of waiting for the next tick. */
        }
      }
    } catch (err) {
      console.error('[scheduler]', err && err.message ? err.message : err);
    } finally {
      this.running = false;
    }
  }

  async send(id, { manual = false } = {}) {
    const draft = await this.store.getDraft(id);
    if (!draft) throw new Error('定时邮件不存在');
    if (!manual && !draft.sendAt) throw new Error('这封邮件没有定时时间');
    if (!manual && Date.parse(draft.sendAt) > Date.now()) throw new Error('还未到发送时间');
    try {
      const result = await this.mail.send({
        accountId: draft.accountId,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        html: draft.html,
        text: '',
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        attachments: draft.attachments
      });
      await this.store.deleteDraft(id);
      this.onEvent({ type: 'sent', id, subject: draft.subject, warning: result && result.warning });
      return result;
    } catch (err) {
      const message = err && err.message ? String(err.message).slice(0, 400) : '发送失败';
      const attempts = (Number(draft.attempts) || 0) + 1;
      const cooldown = Math.min(RETRY_MS * attempts, 60 * 60 * 1000);
      await this.store.markScheduledError(id, message, Date.now() + cooldown);
      this.onEvent({ type: 'error', id, subject: draft.subject, message, attempts });
      throw err;
    }
  }
}

module.exports = { Scheduler };
