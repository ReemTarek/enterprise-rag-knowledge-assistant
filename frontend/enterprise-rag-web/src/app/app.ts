import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LanguageService } from './core/i18n/language.service';
import { LanguageSwitcher } from './shared/language-switcher/language-switcher';

@Component({
  imports: [RouterOutlet, LanguageSwitcher],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  constructor() {
    inject(LanguageService).init();
  }
}
