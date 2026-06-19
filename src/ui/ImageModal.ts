import { App, Modal } from 'obsidian';

/** Fullscreen overlay showing a single image; click anywhere to dismiss. */
class ImageModal extends Modal {
  private src: string;

  constructor(app: App, src: string) {
    super(app);
    this.src = src;
  }

  onOpen(): void {
    this.modalEl.addClass('rb-image-modal');
    this.contentEl.empty();
    const img = this.contentEl.createEl('img', {
      cls: 'rb-image-modal-img',
      attr: { src: this.src },
    });
    img.onclick = () => this.close();
    this.contentEl.onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function openImageModal(app: App, src: string): void {
  new ImageModal(app, src).open();
}
