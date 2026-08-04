import { useEffect, useState } from "react"
import { Bot, Check, Images, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  createCoverJob,
  fetchCoverJob,
  fetchCoverJobs,
  type CoverJob,
  type CoverStyle,
} from "@/lib/api"
import { cn } from "@/lib/utils"

const textStyles: { id: CoverStyle; label: string; className: string }[] = [
  { id: "yellow-red", label: "黄红", className: "bg-yellow-400 text-red-600" },
  { id: "black-yellow", label: "黑黄", className: "bg-black text-yellow-400" },
  { id: "red-white", label: "红白", className: "bg-red-600 text-white" },
]

const SAMPLE_HEADLINES = [
  "破价清仓！最后100件，错过再等一年！",
  "买一送三，今晚不买亏大了！",
  "限时秒杀，库存见底！",
]

export function CoverView() {
  const [mode, setMode] = useState<"ai" | "template">("ai")
  const [headline, setHeadline] = useState("")
  const [style, setStyle] = useState<CoverStyle>("yellow-red")
  const [job, setJob] = useState<CoverJob | null>(null)
  const [history, setHistory] = useState<CoverJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void fetchCoverJobs()
      .then((list) => {
        if (alive) setHistory(list)
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      alive = false
    }
  }, [job?.status])

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return
    const timer = window.setInterval(() => {
      void fetchCoverJob(job.id)
        .then((next) => {
          setJob(next)
          if (next.status === "succeeded" || next.status === "failed") {
            setBusy(false)
          }
        })
        .catch(() => {
          /* keep polling */
        })
    }, 1500)
    return () => window.clearInterval(timer)
  }, [job])

  async function generate() {
    if (!headline.trim()) {
      setError("请填写大字报文案")
      return
    }
    if (mode === "template") {
      setError("图文模版模式即将支持，请先用 AI 智能截取（GPT Image 2）")
      return
    }
    setError(null)
    setBusy(true)
    setSelectedId(null)
    setJob(null)
    try {
      const created = await createCoverJob({
        headline: headline.trim(),
        style,
        count: 4,
        mode: "ai",
      })
      setJob(created)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "创建封面任务失败")
    }
  }

  function fillAiCopy() {
    const next =
      SAMPLE_HEADLINES[Math.floor(Math.random() * SAMPLE_HEADLINES.length)]
    setHeadline(next)
  }

  const showProcessing =
    busy || job?.status === "queued" || job?.status === "running"
  const covers = job?.results ?? []
  const historyCovers = history
    .filter((j) => j.status === "succeeded" && j.results.length > 0)
    .flatMap((j) =>
      j.results.map((r) => ({
        ...r,
        headline: j.headline,
        jobId: j.id,
      }))
    )
    .slice(0, 12)

  return (
    <div className="flex h-full gap-8">
      {/* Settings Card */}
      <Card className="flex w-[360px] shrink-0 flex-col border-slate-200/80 dark:border-slate-800/80 shadow-xs bg-card rounded-2xl">
        <CardHeader className="py-5 px-6 border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">封面生成设置</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-6 p-6">
          <FieldGroup className="gap-6">
            <Field>
              <FieldLabel className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">生成方式</FieldLabel>
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={(v) => {
                  if (v) setMode(v as "ai" | "template")
                }}
                variant="outline"
                className="w-full rounded-lg border-slate-200 dark:border-slate-800"
              >
                <ToggleGroupItem value="ai" className="flex-1 text-xs py-1.5">
                  AI 智能生成
                </ToggleGroupItem>
                <ToggleGroupItem value="template" className="flex-1 text-xs py-1.5">
                  图文模版
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                AI 模式使用 CatsAPI · GPT Image 2
              </p>
            </Field>

            <Field>
              <FieldLabel className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">大字报文案 (吸引眼球)</FieldLabel>
              <Textarea
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="例如：破价清仓！最后100件，错过再等一年！"
                className="h-24 resize-none text-xs rounded-xl border-slate-200 dark:border-slate-800 p-3"
              />
              <button
                type="button"
                className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium cursor-pointer"
                onClick={fillAiCopy}
              >
                <Bot className="size-3.5" />
                AI 帮我写文案
              </button>
            </Field>

            <Field>
              <FieldLabel className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">文字样式</FieldLabel>
              <div className="flex gap-2.5">
                {textStyles.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStyle(item.id)}
                    className={cn(
                      "flex size-9 cursor-pointer items-center justify-center rounded-lg text-xs font-bold transition-all shadow-2xs",
                      item.className,
                      style === item.id
                        ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-950 scale-105"
                        : "opacity-80 hover:opacity-100"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </Field>
          </FieldGroup>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <Button
            className="mt-auto h-11 w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm shadow-xs hover:shadow transition-all active:scale-[0.99] cursor-pointer"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {busy ? "生成中…" : "批量生成封面"}
          </Button>
        </CardContent>
      </Card>

      {/* Results Card */}
      <Card className="flex flex-1 flex-col overflow-y-auto border-slate-200/80 dark:border-slate-800/80 shadow-xs bg-card rounded-2xl">
        <CardHeader className="py-5 px-6 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            生成结果{" "}
            <span className="text-xs font-normal text-slate-400 dark:text-slate-500 ml-1">
              (请选择最满意的一张)
            </span>
          </CardTitle>
          {selectedId ? (
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg">应用所选封面</Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-6 p-6">
          {showProcessing ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-blue-600 py-12">
              <Loader2 className="size-8 animate-spin" />
              <p className="font-medium text-sm text-slate-800 dark:text-slate-200">{job?.message || "准备中…"}</p>
              <p className="text-xs text-slate-400">
                进度 {job?.progress ?? 0}%
              </p>
              {covers.length ? (
                <div className="mt-6 grid w-full grid-cols-2 gap-5 lg:grid-cols-3">
                  {covers.map((cover) => (
                    <div key={cover.id} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-xs">
                      <img
                        src={cover.url}
                        alt=""
                        className="aspect-[3/4] w-full rounded-lg object-cover"
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {job?.status === "failed" ? (
            <p className="text-xs text-destructive">
              生成失败：{job.error || job.message}
            </p>
          ) : null}

          {!showProcessing && covers.length ? (
            <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">
              {covers.map((cover) => {
                const selected = selectedId === cover.id
                return (
                  <button
                    key={cover.id}
                    type="button"
                    className={cn(
                      "group relative cursor-pointer overflow-hidden rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 transition-all hover:shadow-md",
                      selected
                        ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-950"
                        : ""
                    )}
                    onClick={() => setSelectedId(cover.id)}
                  >
                    <img
                      src={cover.url}
                      alt=""
                      className="aspect-[3/4] w-full rounded-lg object-cover"
                    />
                    <div
                      className={cn(
                        "absolute top-4 right-4 flex size-6 items-center justify-center rounded-full transition-all shadow-xs",
                        selected ? "bg-blue-600 text-white" : "bg-black/30 text-white opacity-0 group-hover:opacity-100"
                      )}
                    >
                      <Check className="size-3.5 stroke-[2.5]" />
                    </div>
                  </button>
                )
              })}
            </div>
          ) : null}

          {!showProcessing && !covers.length && job?.status !== "failed" ? (
            historyCovers.length ? (
              <div className="flex flex-col gap-4">
                <p className="text-xs font-medium text-slate-400 dark:text-slate-500">
                  最近生成的封面（来自真实任务记录）
                </p>
                <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">
                  {historyCovers.map((cover) => {
                    const selected = selectedId === cover.id
                    return (
                      <button
                        key={cover.id}
                        type="button"
                        className={cn(
                          "group relative cursor-pointer overflow-hidden rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 transition-all hover:shadow-md",
                          selected
                            ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-950"
                            : ""
                        )}
                        onClick={() => setSelectedId(cover.id)}
                        title={cover.headline}
                      >
                        <img
                          src={cover.url}
                          alt={cover.headline}
                          className="aspect-[3/4] w-full rounded-lg object-cover"
                        />
                        <div
                          className={cn(
                            "absolute top-4 right-4 flex size-6 items-center justify-center rounded-full transition-all shadow-xs",
                            selected ? "bg-blue-600 text-white" : "bg-black/30 text-white opacity-0 group-hover:opacity-100"
                          )}
                        >
                          <Check className="size-3.5 stroke-[2.5]" />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <Empty className="flex-1 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Images className="size-8 text-slate-400" />
                  </EmptyMedia>
                  <EmptyTitle className="text-sm font-semibold text-slate-800 dark:text-slate-200">暂无封面</EmptyTitle>
                  <EmptyDescription className="text-xs text-slate-400">
                    在左侧填写文案并点击生成（GPT Image 2）
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
