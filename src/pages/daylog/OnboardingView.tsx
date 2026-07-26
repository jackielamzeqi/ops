import { useState } from 'react'
import type {
  DaylogDuration,
  DaylogFeedbackStyle,
  DaylogGoal,
  DaylogMemoryLevel,
  DaylogProfile,
} from '../../lib/daylogTypes'
import {
  DAYLOG_DURATIONS,
  DAYLOG_FEEDBACK_STYLES,
  DAYLOG_GOALS,
  DAYLOG_MEMORY_LEVELS,
} from '../../lib/daylogTypes'

/**
 * 首次设置 / 个人设置（说明书 7.1，ONB-01~06）。
 * 全屏覆盖层；所有项均可跳过，「全部跳过」按默认档案直接开始。
 * 着陆区「个人设置」入口复用同一组件（editing 模式）。
 */

const MBTI_TYPES = [
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ',
  'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP',
  'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ',
]
const UNSURE = '不确定/不想填写'
const RELATION_STYLES = ['安全型', '焦虑型', '回避型', '混乱型']

interface Props {
  initial: DaylogProfile
  /** true 表示从「个人设置」进入（显示取消，不再显示全部跳过） */
  editing?: boolean
  onDone: (p: DaylogProfile) => void
  onSkipAll?: () => void
  onClose?: () => void
}

export default function OnboardingView({ initial, editing = false, onDone, onSkipAll, onClose }: Props) {
  const [nickname, setNickname] = useState(initial.nickname)
  const [mbti, setMbti] = useState<string | null>(initial.mbti)
  const [relationStyle, setRelationStyle] = useState<string | null>(initial.relationStyle)
  const [goals, setGoals] = useState<DaylogGoal[]>(initial.goals)
  const [primary, setPrimary] = useState<DaylogFeedbackStyle>(initial.feedbackStyle)
  const [secondary, setSecondary] = useState<DaylogFeedbackStyle | null>(initial.feedbackStyleSecondary)
  const [duration, setDuration] = useState<DaylogDuration>(initial.defaultDuration)
  const [memoryLevel, setMemoryLevel] = useState<DaylogMemoryLevel>(initial.memoryLevel)

  function toggleGoal(g: DaylogGoal) {
    setGoals((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))
  }

  function save() {
    onDone({
      nickname: nickname.trim() || '你',
      mbti,
      relationStyle,
      goals,
      feedbackStyle: primary,
      feedbackStyleSecondary: secondary === primary ? null : secondary,
      defaultDuration: duration,
      memoryLevel,
      onboarded: true,
    })
  }

  return (
    <div className="daylog-onboarding">
      <div className="daylog-onb-card">
        <div className="daylog-onb-head">
          <div className="daylog-onb-title">{editing ? '个人设置' : '开始之前，先认识一下'}</div>
          <div className="daylog-onb-sub">
            所有项都可以跳过；这些选择只用来调整对话方式，随时可以修改。
          </div>
        </div>

        <div className="daylog-onb-section">
          <div className="daylog-onb-label">怎么称呼你（可跳过）</div>
          <input
            className="daylog-onb-input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="默认「你」"
            maxLength={12}
          />
        </div>

        <div className="daylog-onb-section">
          <div className="daylog-onb-label">MBTI（可跳过）</div>
          <div className="daylog-onb-note">仅用于调整沟通方式，不代表专业判断</div>
          <div className="daylog-onb-options compact">
            {[UNSURE, ...MBTI_TYPES].map((t) => (
              <button
                key={t}
                className={`daylog-onb-option ${(t === UNSURE ? mbti === null : mbti === t) ? 'active' : ''}`}
                onClick={() => setMbti(t === UNSURE ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="daylog-onb-section">
          <div className="daylog-onb-label">关系模式（可跳过）</div>
          <div className="daylog-onb-note">仅用于调整沟通方式，不代表专业判断</div>
          <div className="daylog-onb-options">
            {[UNSURE, ...RELATION_STYLES].map((t) => (
              <button
                key={t}
                className={`daylog-onb-option ${(t === UNSURE ? relationStyle === null : relationStyle === t) ? 'active' : ''}`}
                onClick={() => setRelationStyle(t === UNSURE ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="daylog-onb-section">
          <div className="daylog-onb-label">你希望从这里获得什么（可多选，也可不选）</div>
          <div className="daylog-onb-options">
            {DAYLOG_GOALS.map((g) => (
              <button
                key={g.id}
                className={`daylog-onb-option ${goals.includes(g.id) ? 'active' : ''}`}
                onClick={() => toggleGoal(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="daylog-onb-section">
          <div className="daylog-onb-label">反馈风格（主风格必选，次风格可空）</div>
          <div className="daylog-onb-style-grid">
            {DAYLOG_FEEDBACK_STYLES.map((s) => (
              <div key={s.id} className="daylog-onb-style-row">
                <div className="daylog-onb-style-text">
                  <div className="daylog-onb-style-name">{s.label}</div>
                  <div className="daylog-onb-note">{s.desc}</div>
                </div>
                <div className="daylog-onb-style-btns">
                  <button
                    className={`daylog-onb-option ${primary === s.id ? 'active' : ''}`}
                    onClick={() => setPrimary(s.id)}
                  >
                    主
                  </button>
                  <button
                    className={`daylog-onb-option ${secondary === s.id ? 'active' : ''}`}
                    disabled={primary === s.id}
                    onClick={() => setSecondary((prev) => (prev === s.id ? null : s.id))}
                  >
                    次
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="daylog-onb-section">
          <div className="daylog-onb-label">默认时长（首页带入，对话中可临时切换轻量）</div>
          <div className="daylog-onb-options">
            {DAYLOG_DURATIONS.map((d) => (
              <button
                key={d.value}
                className={`daylog-onb-option ${duration === d.value ? 'active' : ''}`}
                onClick={() => setDuration(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="daylog-onb-section">
          <div className="daylog-onb-label">记忆方式（默认不写入长期画像）</div>
          <div className="daylog-onb-memory">
            {DAYLOG_MEMORY_LEVELS.map((m) => (
              <button
                key={m.id}
                className={`daylog-onb-memory-item ${memoryLevel === m.id ? 'active' : ''}`}
                onClick={() => setMemoryLevel(m.id)}
              >
                <div className="daylog-onb-style-name">{m.label}</div>
                <div className="daylog-onb-note">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="daylog-onb-footer">
          {editing ? (
            <>
              <button className="daylog-onb-skip" onClick={onClose}>取消</button>
              <button className="daylog-onb-start" onClick={save}>保存</button>
            </>
          ) : (
            <>
              <button className="daylog-onb-skip" onClick={onSkipAll}>全部跳过</button>
              <button className="daylog-onb-start" onClick={save}>开始</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
