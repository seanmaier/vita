import { useState } from 'react';
import type { ApplicationConfig } from '../../types';
import { napCode, napCopyBtn, napCopyBtnCopied, napFilename, napHeader, napHint, napHintCode, newAppPreview } from '../../styles/formStyles';

/** The new application as JSON, to copy into private/applications/ instead of saving it to the account. */
export function JsonPreviewPanel({ config, className = '' }: { config: ApplicationConfig; className?: string }) {
  const [copied, setCopied] = useState(false);
  const code = JSON.stringify(config, null, 2);
  const filename = `${config.id || 'company'}.json`;

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`${newAppPreview} ${className}`}>
      <div className={napHeader}>
        <span className={napFilename}>private/applications/{filename}</span>
        <button className={copied ? napCopyBtnCopied : napCopyBtn} onClick={copy}>
          {copied ? 'Copied!' : 'Copy JSON'}
        </button>
      </div>
      <pre className={napCode}>{code}</pre>
      <p className={napHint}>
        To commit permanently, save as{' '}
        <code className={napHintCode}>private/applications/{filename}</code> and add the import to{' '}
        <code className={napHintCode}>src/data/applications/index.ts</code>.
      </p>
    </div>
  );
}
