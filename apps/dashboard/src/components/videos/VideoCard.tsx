'use client';

import type { VideoOutput } from '@statsopedia/shared-types';
import { Download, Film, Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ButtonLink, DefinitionList, Modal, Tag } from '@/components/ui';
import { backendUrl } from '@/lib/api/client';
import { formatBytes, formatDuration, formatTimestamp } from '@/lib/format';
import { FORMAT_LABEL, KIND_LABEL } from '@/lib/status';

import styles from './videos.module.css';

/** API paths in outputs start with /api/; the browser reaches them through the proxy. */
const viaProxy = (apiPath: string) => backendUrl(apiPath.replace(/^\/api/, ''));

export function VideoCard({
  output,
  title,
  meta,
}: {
  output: VideoOutput;
  title: string;
  /** Extra lines under the title (project, dataset version). */
  meta?: ReactNode;
}) {
  const [playing, setPlaying] = useState(false);
  const lufs = output.metadata?.audio?.integratedLufs ?? null;
  return (
    <article className={styles.card}>
      <button
        type="button"
        className={styles.thumb}
        onClick={() => setPlaying(true)}
        aria-label={`Play ${title}`}
      >
        {output.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API through the proxy
          <img
            src={viaProxy(output.thumbnailUrl)}
            alt=""
            loading="lazy"
            className={output.format === 'short' ? styles.portrait : undefined}
          />
        ) : (
          <Film size={28} aria-hidden />
        )}
        <span className={styles.play}>
          <Play size={18} fill="currentColor" aria-hidden />
        </span>
        <span className={styles.duration}>{formatDuration(output.durationSeconds)}</span>
      </button>
      <div className={styles.body}>
        <h3 className={styles.title} title={title}>
          {title}
        </h3>
        <div className={styles.tags}>
          <Tag>{FORMAT_LABEL[output.format]}</Tag>
          <Tag>{KIND_LABEL[output.kind]}</Tag>
          <Tag>v{output.renderVersion}</Tag>
        </div>
        {meta ? <div className={styles.meta}>{meta}</div> : null}
        <div className={styles.footer}>
          <span>{formatTimestamp(output.createdAt)}</span>
          <ButtonLink
            href={viaProxy(output.downloadUrl)}
            size="sm"
            variant="ghost"
            icon={Download}
            download
          >
            Download
          </ButtonLink>
        </div>
      </div>
      <Modal open={playing} onClose={() => setPlaying(false)} title={title} wide>
        <div className={styles.playerLayout}>
          <video
            className={output.format === 'short' ? styles.videoPortrait : styles.video}
            src={viaProxy(output.downloadUrl)}
            poster={output.thumbnailUrl ? viaProxy(output.thumbnailUrl) : undefined}
            controls
            autoPlay
            playsInline
          />
          <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
            <DefinitionList
              items={[
                ['Format', `${FORMAT_LABEL[output.format]} · ${output.width}×${output.height}`],
                ['Duration', `${formatDuration(output.durationSeconds)} at ${output.fps} fps`],
                ['Size', formatBytes(output.fileSizeBytes)],
                ['Render', `${KIND_LABEL[output.kind]} v${output.renderVersion}`],
                ['Created', formatTimestamp(output.createdAt)],
                ...(lufs !== null
                  ? ([['Loudness', `${lufs.toFixed(1)} LUFS`]] as [string, string][])
                  : []),
                ...(output.metadata
                  ? ([
                      ['Render time', `${(output.metadata.timingsMs.total / 1000).toFixed(1)} s`],
                    ] as [string, string][])
                  : []),
                ['SHA-256', <code key="sha">{output.checksumSha256.slice(0, 16)}…</code>],
              ]}
            />
            {meta}
            <ButtonLink
              href={viaProxy(output.downloadUrl)}
              variant="primary"
              icon={Download}
              download
            >
              Download MP4
            </ButtonLink>
          </div>
        </div>
      </Modal>
    </article>
  );
}

export function VideoGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
