export interface RenderableTui {
  requestRender(): void;
}

export interface WidgetComponent {
  dispose(): void;
  invalidate(): void;
  render(width: number): string[];
}
