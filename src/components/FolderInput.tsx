import { useId, useState } from 'react';
import { TFolder, type App } from 'obsidian';
import { Input, type InputProps } from '../ui';

/** Every folder path in the vault, sorted; the root excluded. */
export function vaultFolders(app: App): string[] {
  const vault = app.vault as App['vault'] & { getAllFolders?: (root?: boolean) => TFolder[] };
  const all = vault.getAllFolders?.(false) ?? vault.getAllLoadedFiles?.().filter((f): f is TFolder => f instanceof TFolder) ?? [];
  return all
    .map((f) => f.path)
    .filter((p) => p && p !== '/')
    .sort((a, b) => a.localeCompare(b));
}

/** A text box for a vault folder path, suggesting existing folders as you type. */
export function FolderInput({ app, value, onChange, onFocus, ...props }: Omit<InputProps, 'value' | 'onChange' | 'list'> & { app: App; value: string; onChange: (value: string) => void }) {
  // Read on first focus, not every render: a big vault has thousands of folders.
  const [folders, setFolders] = useState<string[] | null>(null);
  const listId = useId();
  return (
    <>
      <Input
        {...props}
        list={listId}
        value={value}
        onFocus={(e) => {
          if (!folders) setFolders(vaultFolders(app));
          onFocus?.(e);
        }}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {folders?.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  );
}
