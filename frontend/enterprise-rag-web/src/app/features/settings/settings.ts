import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatRadioChange, MatRadioModule } from '@angular/material/radio';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  LanguageService,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
} from '../../core/i18n/language.service';

@Component({
  selector: 'app-settings',
  imports: [MatRadioModule, RouterLink, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    section {
      max-inline-size: 480px;
      margin-block-end: 24px;
    }
    h2 {
      font: var(--mat-sys-title-medium);
    }
  `,
  template: `
    <h1>{{ 'settings.heading' | transloco }}</h1>
    <section>
      <h2 id="settings-language">{{ 'settings.language' | transloco }}</h2>
      <mat-radio-group
        aria-labelledby="settings-language"
        [value]="language.current()"
        (change)="select($event)"
      >
        @for (lang of languages; track lang) {
          <mat-radio-button [value]="lang">{{
            'language.name.' + lang | transloco
          }}</mat-radio-button>
        }
      </mat-radio-group>
    </section>
    <section>
      <h2>{{ 'settings.security' | transloco }}</h2>
      <a routerLink="/change-password">{{ 'settings.changePassword' | transloco }}</a>
    </section>
  `,
})
export class Settings {
  protected readonly language = inject(LanguageService);
  protected readonly languages = SUPPORTED_LANGUAGES;

  protected select(event: MatRadioChange<unknown>): void {
    if (isSupportedLanguage(event.value)) this.language.set(event.value);
  }
}
