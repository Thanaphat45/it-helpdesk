import { inject } from '@angular/core';
import { Router, type CanActivateFn, type Routes } from '@angular/router';
import { Session } from './api';
import { DashboardPage, LoginPage, TicketPage, TicketsPage } from './pages';

const signedIn: CanActivateFn = () => !!inject(Session).user() || inject(Router).parseUrl('/login');
const staff: CanActivateFn = () => inject(Session).isStaff() || inject(Router).parseUrl('/tickets');

export const routes: Routes = [
  { path: 'login', component: LoginPage, title: 'เข้าสู่ระบบ · IT Helpdesk' },
  { path: 'tickets', component: TicketsPage, canActivate: [signedIn], title: 'รายการแจ้งซ่อม · IT Helpdesk' },
  { path: 'tickets/:id', component: TicketPage, canActivate: [signedIn], title: 'รายละเอียด · IT Helpdesk' },
  { path: 'dashboard', component: DashboardPage, canActivate: [signedIn, staff], title: 'ภาพรวม · IT Helpdesk' },
  { path: '**', redirectTo: 'tickets' },
];
