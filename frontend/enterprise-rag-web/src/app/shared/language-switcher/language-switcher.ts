import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService, SUPPORTED_LANGUAGES, SupportedLanguage } from '../../core/i18n/language.service';

@Component({
  selector: 'app-language-switcher',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, TranslocoPipe],
  templateUrl: './language-switcher.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageSwitcher {
  protected readonly language = inject(LanguageService);
  protected readonly languages = SUPPORTED_LANGUAGES;

  protected select(lang: SupportedLanguage): void {
    this.language.set(lang);
  }
}
