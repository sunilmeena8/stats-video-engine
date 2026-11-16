'use client';

import {
  ANNOTATION_KINDS,
  ANNOTATION_POSITIONS,
  ANNOTATION_PRIORITIES,
  ANNOTATION_STYLES,
  type AnnotationKind,
  type EditorialAnnotation,
  type MediaAsset,
  type SourceReference,
} from '@statsopedia/shared-types';
import { Link2, Lightbulb, MessageSquarePlus, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Segmented,
  Select,
  Tag,
} from '@/components/ui';

import styles from './studio.module.css';

export const KIND_LABEL: Record<AnnotationKind, string> = {
  milestone: 'Historical milestone',
  ranking_change: 'Ranking change',
  winner: 'Winner',
  top_entry: 'Entry into top ranks',
  value_change: 'Significant change',
  caption: 'Explanatory caption',
};
const STYLE_LABEL: Record<EditorialAnnotation['style'], string> = {
  card: 'Card',
  callout: 'Callout',
  banner: 'Banner',
};
const POSITION_LABEL: Record<EditorialAnnotation['position'], string> = {
  auto: 'Auto (keep bars visible)',
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

const newId = () => `note-${crypto.randomUUID().slice(0, 8)}`;

function SourcesEditor({
  sources,
  required,
  datasetSources,
  onChange,
}: {
  sources: SourceReference[];
  required: boolean;
  datasetSources: SourceReference[];
  onChange: (sources: SourceReference[]) => void;
}) {
  const update = (index: number, patch: Partial<SourceReference>) =>
    onChange(sources.map((source, i) => (i === index ? { ...source, ...patch } : source)));
  const unused = datasetSources.filter(
    (candidate) => !sources.some((source) => source.name === candidate.name),
  );
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className={styles.annotationHead}>
        <Link2 size={13} aria-hidden />
        Sources
        {required && sources.length === 0 ? (
          <span className={`${styles.note} ${styles.noteCritical}`}>
            Required: cite where this fact comes from
          </span>
        ) : (
          <span />
        )}
      </div>
      {sources.map((source, index) => (
        <div key={index} className={styles.sourceRow}>
          <Input
            aria-label="Publication or organisation"
            placeholder="Publication"
            value={source.name}
            maxLength={120}
            onChange={(e) => update(index, { name: e.target.value })}
          />
          <Input
            aria-label="Source URL"
            placeholder="https://… (optional)"
            value={source.url ?? ''}
            onChange={(e) => update(index, { url: e.target.value.trim() || null })}
          />
          <IconButton
            icon={X}
            label="Remove source"
            onClick={() => onChange(sources.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button
          size="sm"
          variant="ghost"
          icon={Plus}
          disabled={sources.length >= 5}
          onClick={() => onChange([...sources, { name: '', url: null }])}
        >
          Add source
        </Button>
        {unused.length ? (
          <Button
            size="sm"
            variant="ghost"
            icon={Plus}
            disabled={sources.length >= 5}
            onClick={() => onChange([...sources, ...unused].slice(0, 5))}
          >
            Cite the dataset
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AnnotationCard({
  annotation,
  periods,
  images,
  datasetSources,
  onChange,
  onRemove,
}: {
  annotation: EditorialAnnotation;
  periods: string[];
  images: MediaAsset[];
  datasetSources: SourceReference[];
  onChange: (annotation: EditorialAnnotation) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<EditorialAnnotation>) => onChange({ ...annotation, ...patch });
  const { timing } = annotation;
  const imageAsset = /^media:(.+)$/.exec(annotation.imageUrl ?? '')?.[1];
  const imageMode = annotation.imageUrl === null ? '' : imageAsset ? imageAsset : 'url';

  return (
    <div className={styles.annotation}>
      <div className={styles.annotationGrid4}>
        <Field label="Kind">
          {(id) => (
            <Select
              id={id}
              value={annotation.kind}
              onChange={(e) => set({ kind: e.target.value as AnnotationKind })}
            >
              {ANNOTATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority" hint="Wins its place when notes overlap">
          {(id) => (
            <Select
              id={id}
              value={annotation.priority}
              onChange={(e) => set({ priority: e.target.value as EditorialAnnotation['priority'] })}
            >
              {ANNOTATION_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority[0]!.toUpperCase() + priority.slice(1)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className={styles.annotationGrid}>
        <Field label="Title" aside={`${annotation.title.length}/80`}>
          {(id) => (
            <Input
              id={id}
              value={annotation.title}
              maxLength={80}
              onChange={(e) => set({ title: e.target.value })}
            />
          )}
        </Field>
        <Field label="Icon" hint="Emoji or symbol">
          {(id) => (
            <Input
              id={id}
              value={annotation.icon ?? ''}
              maxLength={8}
              onChange={(e) => set({ icon: e.target.value || null })}
            />
          )}
        </Field>
      </div>
      <Field label="Description" aside={`${(annotation.text ?? '').length}/240`}>
        {(id) => (
          <Input
            id={id}
            value={annotation.text ?? ''}
            maxLength={240}
            onChange={(e) => set({ text: e.target.value || null })}
          />
        )}
      </Field>

      <Segmented<'period' | 'time'>
        label="Timing"
        value={timing.kind === 'period' ? 'period' : 'time'}
        onChange={(kind) =>
          set({
            timing:
              kind === 'period'
                ? {
                    kind: 'period',
                    period: periods[Math.floor(periods.length / 2)] ?? '',
                    durationSeconds: 3,
                  }
                : { kind: 'time', startSeconds: 5, endSeconds: 9 },
          })
        }
        options={[
          { value: 'period', label: 'At a period' },
          { value: 'time', label: 'Time range' },
        ]}
      />
      {timing.kind === 'period' ? (
        <div className={styles.annotationGrid4}>
          <Field label="Year or period">
            {(id) => (
              <Select
                id={id}
                value={timing.period}
                onChange={(e) => set({ timing: { ...timing, period: e.target.value } })}
              >
                {periods.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Shown for (s)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={60}
                step={0.5}
                value={timing.durationSeconds}
                onChange={(e) =>
                  set({ timing: { ...timing, durationSeconds: Number(e.target.value) } })
                }
              />
            )}
          </Field>
        </div>
      ) : timing.kind === 'time' ? (
        <div className={styles.annotationGrid4}>
          <Field label="Starts at (s)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                step={0.5}
                value={timing.startSeconds}
                onChange={(e) =>
                  set({ timing: { ...timing, startSeconds: Number(e.target.value) } })
                }
              />
            )}
          </Field>
          <Field label="Ends at (s)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                step={0.5}
                value={timing.endSeconds}
                onChange={(e) => set({ timing: { ...timing, endSeconds: Number(e.target.value) } })}
              />
            )}
          </Field>
        </div>
      ) : (
        <span className={styles.note}>
          Frames {timing.startFrame}–{timing.endFrame} (set by the API).
        </span>
      )}

      <div className={styles.annotationGrid4}>
        <Field label="Style">
          {(id) => (
            <Select
              id={id}
              value={annotation.style}
              onChange={(e) => set({ style: e.target.value as EditorialAnnotation['style'] })}
            >
              {ANNOTATION_STYLES.map((style) => (
                <option key={style} value={style}>
                  {STYLE_LABEL[style]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Position" hint="Portrait uses the title band">
          {(id) => (
            <Select
              id={id}
              value={annotation.position}
              disabled={annotation.style === 'banner'}
              onChange={(e) => set({ position: e.target.value as EditorialAnnotation['position'] })}
            >
              {ANNOTATION_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {POSITION_LABEL[position]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field label="Image" hint="Optional, shown beside the text">
        {(id) => (
          <div style={{ display: 'grid', gap: 8 }}>
            <Select
              id={id}
              value={imageMode}
              onChange={(e) => {
                const value = e.target.value;
                set({
                  imageUrl: value === '' ? null : value === 'url' ? 'https://' : `media:${value}`,
                });
              }}
            >
              <option value="">No image</option>
              {images.map((image) => (
                <option key={image.id} value={image.id}>
                  {image.name} ({image.type})
                </option>
              ))}
              <option value="url">Image URL…</option>
            </Select>
            {imageMode === 'url' ? (
              <Input
                aria-label="Image URL"
                value={annotation.imageUrl ?? ''}
                onChange={(e) => set({ imageUrl: e.target.value || null })}
              />
            ) : null}
          </div>
        )}
      </Field>

      <SourcesEditor
        sources={annotation.sources}
        required={annotation.kind !== 'caption'}
        datasetSources={datasetSources}
        onChange={(sources) => set({ sources })}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

function SuggestionsDialog({
  suggestions,
  existing,
  onAdd,
  onClose,
}: {
  suggestions: EditorialAnnotation[];
  existing: EditorialAnnotation[];
  onAdd: (annotations: EditorialAnnotation[]) => void;
  onClose: () => void;
}) {
  const fresh = suggestions.filter((s) => !existing.some((e) => e.id === s.id));
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(fresh.filter((s) => s.priority !== 'low').map((s) => s.id)),
  );
  const room = 20 - existing.length;
  return (
    <Modal
      open
      onClose={onClose}
      title="Suggestions from the data"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={chosen.size === 0 || chosen.size > room}
            title={chosen.size > room ? `Room for ${room} more annotations` : undefined}
            onClick={() => {
              onAdd(fresh.filter((s) => chosen.has(s.id)));
              onClose();
            }}
          >
            Add {chosen.size}
          </Button>
        </>
      }
    >
      <p className={styles.note} style={{ margin: '0 0 10px' }}>
        Read from this dataset version only and cited to its sources. Historical events are never
        suggested; add those as milestones with their own sources.
      </p>
      {fresh.length === 0 ? (
        <EmptyState icon={Lightbulb} title="Nothing new to suggest">
          The dataset has no lead changes or big moves you have not added yet.
        </EmptyState>
      ) : (
        fresh.map((suggestion) => (
          <div key={suggestion.id} className={styles.suggestion}>
            <Checkbox
              label={
                <span
                  style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <strong style={{ fontSize: 13 }}>
                    {suggestion.icon} {suggestion.title}
                  </strong>
                  <Tag>{KIND_LABEL[suggestion.kind]}</Tag>
                </span>
              }
              checked={chosen.has(suggestion.id)}
              onChange={(checked) =>
                setChosen((current) => {
                  const next = new Set(current);
                  if (checked) next.add(suggestion.id);
                  else next.delete(suggestion.id);
                  return next;
                })
              }
            />
            <div className={styles.note} style={{ paddingLeft: 26 }}>
              {suggestion.text}
            </div>
          </div>
        ))
      )}
    </Modal>
  );
}

/**
 * Editorial annotations. Facts need sources (only captions may have none); the shared schema
 * checks them in the live preview and on save. Data-driven notes can be suggested from the
 * dataset; historical milestones are always written by the editor.
 */
export function AnnotationsEditor({
  annotations,
  periods,
  images,
  datasetSources,
  suggest,
  onChange,
}: {
  annotations: EditorialAnnotation[];
  periods: string[];
  /** Uploaded images and logos that can illustrate a note. */
  images: MediaAsset[];
  datasetSources: SourceReference[];
  /** Data-driven suggestions for the current range, or null while the dataset loads. */
  suggest: (() => EditorialAnnotation[]) | null;
  onChange: (annotations: EditorialAnnotation[]) => void;
}) {
  const [suggesting, setSuggesting] = useState<EditorialAnnotation[] | null>(null);
  const add = (kind: AnnotationKind) =>
    onChange([
      ...annotations,
      {
        id: newId(),
        kind,
        title: kind === 'caption' ? 'Caption' : 'New milestone',
        text: null,
        icon: null,
        imageUrl: null,
        sources: [],
        timing: {
          kind: 'period',
          period: periods[Math.floor(periods.length / 2)] ?? '',
          durationSeconds: 3,
        },
        priority: 'normal',
        style: 'card',
        position: 'auto',
      },
    ]);
  const full = annotations.length >= 20;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {annotations.length === 0 ? (
        <EmptyState icon={MessageSquarePlus} title="No annotations">
          Mark a milestone, a change of leader or a record, with its source.
        </EmptyState>
      ) : null}
      {annotations.map((annotation, index) => (
        <AnnotationCard
          key={annotation.id}
          annotation={annotation}
          periods={periods}
          images={images}
          datasetSources={datasetSources}
          onChange={(next) => onChange(annotations.map((item, i) => (i === index ? next : item)))}
          onRemove={() => onChange(annotations.filter((_, i) => i !== index))}
        />
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          icon={MessageSquarePlus}
          onClick={() => add('milestone')}
          disabled={!periods.length || full}
        >
          Add milestone
        </Button>
        <Button
          variant="ghost"
          icon={Plus}
          onClick={() => add('caption')}
          disabled={!periods.length || full}
        >
          Caption
        </Button>
        <Button
          variant="ghost"
          icon={Lightbulb}
          disabled={!suggest || full}
          onClick={() => setSuggesting(suggest?.() ?? [])}
        >
          Suggest from data
        </Button>
      </div>
      {suggesting ? (
        <SuggestionsDialog
          suggestions={suggesting}
          existing={annotations}
          onAdd={(added) => onChange([...annotations, ...added])}
          onClose={() => setSuggesting(null)}
        />
      ) : null}
    </div>
  );
}
