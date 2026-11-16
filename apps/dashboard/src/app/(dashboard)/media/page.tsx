'use client';

import {
  LICENSE_TYPES,
  MEDIA_ASSET_TYPES,
  MUSIC_CATEGORIES,
  type LicenseType,
  type MediaAsset,
  type MediaAssetType,
  type MusicCategory,
} from '@statsopedia/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, Images, Music, Pencil, Type, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  Button,
  Checkbox,
  EmptyState,
  ErrorBanner,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Panel,
  QueryState,
  Segmented,
  Select,
  StatusPill,
  Tabs,
  Tag,
  table,
  useToast,
} from '@/components/ui';
import { backendUrl } from '@/lib/api/client';
import { endpoints, type MediaUploadMeta } from '@/lib/api/endpoints';
import { keys, useMedia } from '@/lib/api/queries';
import { formatBytes, formatDate, formatDuration } from '@/lib/format';
import {
  LICENSE_TYPE_LABEL,
  MUSIC_CATEGORY_LABEL,
  commercialUse,
  loudnessLabel,
} from '@/lib/media';

type Filter = MediaAssetType | 'all';
const UPLOADABLE = MEDIA_ASSET_TYPES.filter((type) => type !== 'thumbnail');
const TYPE_LABEL: Record<MediaAssetType, string> = {
  music: 'Music',
  logo: 'Logos',
  image: 'Images',
  font: 'Fonts',
  thumbnail: 'Thumbnails',
};
const ACCEPT: Partial<Record<MediaAssetType, string>> = {
  music: 'audio/wav,audio/mpeg,audio/ogg,audio/mp4,.wav,.mp3,.ogg,.m4a',
  logo: 'image/png,image/jpeg,image/webp',
  image: 'image/png,image/jpeg,image/webp',
  font: '.woff2,font/woff2',
};

export default function MediaPage() {
  const [filter, setFilter] = useState<Filter>('music');
  const [category, setCategory] = useState<MusicCategory | 'all'>('all');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<MediaAsset | null>(null);
  const media = useMedia(filter === 'all' ? undefined : filter);
  const music = filter === 'music';
  return (
    <>
      <PageHeader
        title="Media Library"
        description="Music, logos, images and fonts used by videos. Files are checked by their content; music is decoded and measured on upload, and keeps its licensing with it."
        actions={
          <Button variant="primary" icon={Upload} onClick={() => setUploading(true)}>
            Upload
          </Button>
        }
      />
      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'all', label: 'All' },
          ...UPLOADABLE.map((type) => ({ value: type, label: TYPE_LABEL[type] })),
        ]}
      />
      {music ? (
        <div style={{ margin: '0 0 12px', overflowX: 'auto' }}>
          <Segmented<MusicCategory | 'all'>
            label="Category"
            value={category}
            onChange={setCategory}
            options={[
              { value: 'all', label: 'All moods' },
              ...MUSIC_CATEGORIES.map((value) => ({
                value,
                label: MUSIC_CATEGORY_LABEL[value],
              })),
            ]}
          />
        </div>
      ) : null}
      <Panel flush>
        <QueryState
          query={media}
          isEmpty={(data) => data.length === 0}
          empty={
            <EmptyState
              icon={Images}
              title="Nothing uploaded yet"
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon={Upload}
                  onClick={() => setUploading(true)}
                >
                  Upload a file
                </Button>
              }
            >
              Add a licensed music track to give videos a soundtrack.
            </EmptyState>
          }
        >
          {(assets) => {
            const shown =
              music && category !== 'all'
                ? assets.filter((asset) => asset.category === category)
                : assets;
            if (!shown.length) {
              return (
                <EmptyState icon={Music} title="No tracks in this category">
                  Upload one, or choose another mood.
                </EmptyState>
              );
            }
            return (
              <div className={table.wrap}>
                <table className={table.table}>
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>{music ? 'Category' : 'Type'}</th>
                      <th>Preview</th>
                      {music ? <th>Level</th> : null}
                      <th>License</th>
                      <th className={table.num}>Size</th>
                      <th>Uploaded</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((asset) => (
                      <AssetRow
                        key={asset.id}
                        asset={asset}
                        music={music}
                        onEdit={() => setEditing(asset)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </QueryState>
      </Panel>
      <UploadDialog
        open={uploading}
        initialType={filter === 'all' ? 'music' : filter}
        onClose={() => setUploading(false)}
      />
      {editing ? <EditDialog asset={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function AssetRow({
  asset,
  music,
  onEdit,
}: {
  asset: MediaAsset;
  music: boolean;
  onEdit: () => void;
}) {
  const src = backendUrl(`/media/${asset.id}/file`);
  const Icon = asset.type === 'music' ? Music : asset.type === 'font' ? Type : ImageIcon;
  const use = commercialUse(asset);
  return (
    <tr>
      <td>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Icon size={16} color="var(--sp-color-accent-strong)" aria-hidden />
          <div>
            <div className={table.strong}>{asset.name}</div>
            <div className={table.muted} style={{ fontSize: 12 }}>
              {asset.fileFormat.toUpperCase()}
              {asset.durationSeconds ? ` · ${formatDuration(asset.durationSeconds)}` : ''}
              {asset.audio
                ? ` · ${(asset.audio.sampleRate / 1000).toFixed(1)} kHz ${asset.audio.channels === 1 ? 'mono' : 'stereo'}`
                : ''}
              {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
            </div>
          </div>
        </div>
      </td>
      <td>
        {music ? (
          asset.category ? (
            <Tag>{MUSIC_CATEGORY_LABEL[asset.category]}</Tag>
          ) : (
            <span className={table.muted}>Uncategorized</span>
          )
        ) : (
          <Tag>{TYPE_LABEL[asset.type]}</Tag>
        )}
      </td>
      <td>
        {asset.type === 'music' ? (
          <audio controls preload="none" src={src} style={{ height: 32, width: 220 }} />
        ) : asset.type === 'logo' || asset.type === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API through the proxy
          <img
            src={src}
            alt=""
            loading="lazy"
            style={{ height: 36, maxWidth: 120, objectFit: 'contain', borderRadius: 4 }}
          />
        ) : (
          <span className={table.muted}>—</span>
        )}
      </td>
      {music ? (
        <td className={table.muted} style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
          {loudnessLabel(asset) ?? 'Not measured'}
        </td>
      ) : null}
      <td>
        <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
          <span style={{ fontSize: 13 }}>
            {[asset.licenseType ? LICENSE_TYPE_LABEL[asset.licenseType] : null, asset.license]
              .filter(Boolean)
              .join(' · ') || <span className={table.muted}>Not recorded</span>}
          </span>
          {asset.type === 'music' ? <StatusPill tone={use.tone} label={use.label} /> : null}
          {asset.attributionRequired ? (
            <span className={table.muted} style={{ fontSize: 12 }}>
              Credit: {asset.attribution}
            </span>
          ) : null}
        </div>
      </td>
      <td className={table.num}>{formatBytes(asset.fileSizeBytes)}</td>
      <td className={table.muted}>{formatDate(asset.uploadedAt)}</td>
      <td>
        <IconButton icon={Pencil} label={`Edit ${asset.name}`} onClick={onEdit} />
      </td>
    </tr>
  );
}

interface Licensing {
  category: MusicCategory | '';
  licenseType: LicenseType | '';
  license: string;
  commercialUse: 'yes' | 'no' | '';
  attributionRequired: boolean;
  attribution: string;
  licenseReference: string;
}

const EMPTY_LICENSING: Licensing = {
  category: '',
  licenseType: '',
  license: '',
  commercialUse: '',
  attributionRequired: false,
  attribution: '',
  licenseReference: '',
};

/** Licensing fields of a file. The API checks them; this only collects them. */
function LicensingFields({
  value,
  onChange,
  music,
}: {
  value: Licensing;
  onChange: (value: Licensing) => void;
  music: boolean;
}) {
  const set = (patch: Partial<Licensing>) => onChange({ ...value, ...patch });
  return (
    <>
      {music ? (
        <Field label="Category" hint="The mood the track suits.">
          {(id) => (
            <Select
              id={id}
              value={value.category}
              onChange={(e) => set({ category: e.target.value as MusicCategory })}
            >
              <option value="">Choose…</option>
              {MUSIC_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {MUSIC_CATEGORY_LABEL[item]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: '1fr 1fr' }}>
        <Field label="License type">
          {(id) => (
            <Select
              id={id}
              value={value.licenseType}
              onChange={(e) => set({ licenseType: e.target.value as LicenseType })}
            >
              <option value="">Choose…</option>
              {LICENSE_TYPES.map((item) => (
                <option key={item} value={item}>
                  {LICENSE_TYPE_LABEL[item]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="License" hint="Name or version, e.g. CC BY 4.0">
          {(id) => (
            <Input
              id={id}
              value={value.license}
              onChange={(e) => set({ license: e.target.value })}
            />
          )}
        </Field>
      </div>
      {music ? (
        <Field label="Commercial use" hint="May it be used in monetized, published videos?">
          {() => (
            <Segmented<'yes' | 'no' | ''>
              label="Commercial use"
              value={value.commercialUse}
              onChange={(commercialUse) => set({ commercialUse })}
              options={[
                { value: 'yes', label: 'Allowed' },
                { value: 'no', label: 'Not allowed' },
              ]}
            />
          )}
        </Field>
      ) : null}
      <Checkbox
        label="The license requires attribution in the video"
        checked={value.attributionRequired}
        onChange={(attributionRequired) => set({ attributionRequired })}
      />
      <Field
        label="Credit line"
        hint={
          value.attributionRequired
            ? 'Shown on the end card and in the credits, exactly as written.'
            : 'Optional.'
        }
      >
        {(id) => (
          <Input
            id={id}
            value={value.attribution}
            maxLength={300}
            placeholder="“Track” by Artist, licensed under CC BY 4.0"
            onChange={(e) => set({ attribution: e.target.value })}
          />
        )}
      </Field>
      <Field label="License document or reference" hint="A URL, invoice or agreement number.">
        {(id) => (
          <Input
            id={id}
            value={value.licenseReference}
            onChange={(e) => set({ licenseReference: e.target.value })}
          />
        )}
      </Field>
    </>
  );
}

function UploadDialog({
  open,
  initialType,
  onClose,
}: {
  open: boolean;
  initialType: MediaAssetType;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<MediaAssetType | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [licensing, setLicensing] = useState<Licensing>(EMPTY_LICENSING);
  const chosenType = type ?? initialType;
  const reset = () => {
    setType(null);
    setFile(null);
    setName('');
    setLicensing(EMPTY_LICENSING);
  };
  const upload = useMutation({
    mutationFn: () => {
      const meta: MediaUploadMeta = { type: chosenType };
      if (name) meta.name = name;
      if (chosenType === 'music' && licensing.category) meta.category = licensing.category;
      if (licensing.licenseType) meta.licenseType = licensing.licenseType;
      if (licensing.license) meta.license = licensing.license;
      if (chosenType === 'music' && licensing.commercialUse) {
        meta.commercialUse = licensing.commercialUse === 'yes';
      }
      if (licensing.attributionRequired) meta.attributionRequired = true;
      if (licensing.attribution) meta.attribution = licensing.attribution;
      if (licensing.licenseReference) meta.licenseReference = licensing.licenseReference;
      return endpoints.uploadMedia(file!, meta);
    },
    onSuccess: (asset) => {
      void client.invalidateQueries({ queryKey: ['media'] });
      void client.invalidateQueries({ queryKey: keys.stats });
      toast({
        tone: 'good',
        title: `${asset.name} uploaded`,
        ...(asset.durationSeconds
          ? { detail: `${formatDuration(asset.durationSeconds)} · ${loudnessLabel(asset) ?? ''}` }
          : {}),
      });
      reset();
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload media"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Upload}
            disabled={!file}
            loading={upload.isPending}
            onClick={() => upload.mutate()}
          >
            Upload
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <ErrorBanner error={upload.error} title="Not uploaded" />
        <Field label="Type">
          {(id) => (
            <Select
              id={id}
              value={chosenType}
              onChange={(e) => setType(e.target.value as MediaAssetType)}
            >
              {UPLOADABLE.map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="File"
          hint={
            chosenType === 'music'
              ? 'WAV, MP3, OGG or M4A, 5 s to 30 min. It is decoded in full and its loudness and peak are measured.'
              : chosenType === 'font'
                ? 'WOFF2'
                : 'PNG, JPEG or WebP'
          }
        >
          {(id) => (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                id={id}
                ref={input}
                type="file"
                hidden
                accept={ACCEPT[chosenType]}
                onChange={(e) => {
                  const selected = e.target.files?.[0] ?? null;
                  setFile(selected);
                  if (selected && !name) setName(selected.name.replace(/\.[a-z0-9]+$/i, ''));
                }}
              />
              <Button size="sm" onClick={() => input.current?.click()}>
                Choose file
              </Button>
              <span style={{ color: 'var(--sp-color-text-secondary)', fontSize: 13 }}>
                {file ? `${file.name} · ${formatBytes(file.size)}` : 'No file chosen'}
              </span>
            </div>
          )}
        </Field>
        <Field label="Name">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <LicensingFields value={licensing} onChange={setLicensing} music={chosenType === 'music'} />
      </div>
    </Modal>
  );
}

const licensingOf = (asset: MediaAsset): Licensing => ({
  category: asset.category ?? '',
  licenseType: asset.licenseType ?? '',
  license: asset.license ?? '',
  commercialUse: asset.commercialUse === null ? '' : asset.commercialUse ? 'yes' : 'no',
  attributionRequired: asset.attributionRequired,
  attribution: asset.attribution ?? '',
  licenseReference: asset.licenseReference ?? '',
});

function EditDialog({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(asset.name);
  const [licensing, setLicensing] = useState(licensingOf(asset));
  const music = asset.type === 'music';
  const save = useMutation({
    mutationFn: () =>
      endpoints.updateMedia(asset.id, {
        name,
        ...(music ? { category: licensing.category || null } : {}),
        licenseType: licensing.licenseType || null,
        license: licensing.license || null,
        ...(music
          ? { commercialUse: licensing.commercialUse ? licensing.commercialUse === 'yes' : null }
          : {}),
        attributionRequired: licensing.attributionRequired,
        attribution: licensing.attribution || null,
        licenseReference: licensing.licenseReference || null,
      }),
    onSuccess: (updated) => {
      void client.invalidateQueries({ queryKey: ['media'] });
      toast({ tone: 'good', title: `${updated.name} saved` });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${asset.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <ErrorBanner error={save.error} title="Not saved" />
        <p style={{ margin: 0, color: 'var(--sp-color-text-secondary)', fontSize: 13 }}>
          Renders already submitted keep the licensing they were made with.
        </p>
        <Field label="Name">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <LicensingFields value={licensing} onChange={setLicensing} music={music} />
      </div>
    </Modal>
  );
}
