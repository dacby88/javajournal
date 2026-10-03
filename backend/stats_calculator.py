import numpy as np
import pandas as pd
import math
from datetime import datetime, timedelta
from models import db, Trade, Execution, DailyStats, OverallStats, HourlyStats, Account
from sqlalchemy import func


def safe_float(value, default=0):
    """Convert to float, replacing NaN/Inf with default value"""
    if value is None:
        return default
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default


def compute_sharpe_ratio(daily_returns, account_value=None):
    """Annualized Sharpe ratio from a daily P&L series (zero risk-free rate).

    When account_value (the account's configured starting value) is provided,
    daily dollar P&L is converted to returns on a running equity base: equity
    starts at account_value and accumulates each day's P&L. Otherwise the raw
    dollar series is used.
    """
    if len(daily_returns) <= 1:
        return 0
    series = daily_returns
    if account_value and account_value > 0:
        equity = float(account_value)
        pct_returns = []
        for dt in sorted(daily_returns.index):
            pnl = float(daily_returns[dt])
            pct_returns.append(pnl / equity if equity > 0 else 0)
            equity += pnl
        series = pd.Series(pct_returns)
    std = series.std()
    return safe_float((series.mean() / std) * np.sqrt(252) if std != 0 else 0)


def get_account_starting_value(account_id):
    """Return the account's configured starting_account_value setting, or None."""
    if not account_id:
        return None
    account = Account.query.get(account_id)
    if account and account.settings:
        return account.settings.get('starting_account_value')
    return None

def calculate_overall_stats(account_id=None):
    """Calculate overall trading statistics from completed trades"""
    query = Trade.query.filter(Trade.is_open == False)
    if account_id:
        query = query.filter((Trade.account_id == account_id) | (Trade.account_id == None))
    trades = query.all()
    
    if not trades:
        return None
    
    # Convert to DataFrame for easier calculations
    df = pd.DataFrame([t.to_dict() for t in trades])
    df['net_pnl'] = df['net_pnl'].astype(float)
    df['gross_pnl'] = df['gross_pnl'].astype(float)
    
    # Filter out trades with no exit_date for date-based calculations
    df_with_exit = df[df['exit_date'].notna()].copy()
    
    # Basic counts
    total_trades = len(df)
    winning_trades = len(df[df['net_pnl'] > 0])
    losing_trades = len(df[df['net_pnl'] < 0])
    break_even_trades = len(df[df['net_pnl'] == 0])
    
    win_rate = safe_float((winning_trades / total_trades * 100) if total_trades > 0 else 0)
    loss_rate = safe_float((losing_trades / total_trades * 100) if total_trades > 0 else 0)
    
    # P&L calculations
    gross_profit = df[df['gross_pnl'] > 0]['gross_pnl'].sum()
    gross_loss = abs(df[df['gross_pnl'] < 0]['gross_pnl'].sum())
    net_pnl = df['net_pnl'].sum()
    total_commission = df['total_commissions'].sum()
    
    # Average calculations
    avg_win = df[df['net_pnl'] > 0]['net_pnl'].mean() if winning_trades > 0 else 0
    avg_loss = df[df['net_pnl'] < 0]['net_pnl'].mean() if losing_trades > 0 else 0
    
    # Extremes
    largest_profit = df['net_pnl'].max()
    largest_loss = df['net_pnl'].min()
    
    # Profit factor
    profit_factor = safe_float(gross_profit / gross_loss if gross_loss != 0 else 0)
    
    # Expectancy
    avg_trade = df['net_pnl'].mean()
    expectancy = safe_float(avg_trade)
    
    # Sharpe Ratio (using daily returns) - only from trades with exit dates
    sharpe_ratio = 0
    sortino_ratio = 0
    calmar_ratio = 0
    avg_trade_duration = 0
    longest_win_streak = 0
    longest_loss_streak = 0
    longest_win_streak_amount = 0
    longest_loss_streak_amount = 0
    current_win_streak = 0
    current_loss_streak = 0
    current_win_streak_amount = 0
    current_loss_streak_amount = 0
    
    if len(df_with_exit) > 0:
        df_with_exit['exit_date'] = pd.to_datetime(df_with_exit['exit_date'])
        df_with_exit['entry_date'] = pd.to_datetime(df_with_exit['entry_date'])
        daily_returns = df_with_exit.groupby(df_with_exit['exit_date'].dt.date)['net_pnl'].sum()
        
        sharpe_ratio = compute_sharpe_ratio(daily_returns, get_account_starting_value(account_id))
        
        # Sortino Ratio (downside deviation)
        downside_returns = daily_returns[daily_returns < 0]
        if len(downside_returns) > 0 and downside_returns.std() != 0:
            sortino_ratio = safe_float((daily_returns.mean() / downside_returns.std()) * np.sqrt(252))
        
        # Calmar Ratio (annual return / max drawdown)
        cumulative = daily_returns.cumsum()
        running_max = cumulative.expanding().max()
        drawdown = cumulative - running_max
        max_drawdown = abs(drawdown.min()) if len(drawdown) > 0 else 0
        
        annual_return = safe_float(daily_returns.mean() * 252)
        calmar_ratio = safe_float(annual_return / max_drawdown if max_drawdown != 0 else 0)
        
        # Trade duration
        df_with_exit['duration_days'] = (df_with_exit['exit_date'] - df_with_exit['entry_date']).dt.days
        avg_trade_duration = safe_float(df_with_exit['duration_days'].mean())
        
        # Streak analysis - based on DAILY net P&L (not individual trades)
        daily_pnl = daily_returns.sort_index()
        
        for daily_net in daily_pnl:
            if daily_net > 0:  # Profitable day
                current_win_streak += 1
                current_win_streak_amount += daily_net
                current_loss_streak = 0
                current_loss_streak_amount = 0
                if current_win_streak > longest_win_streak:
                    longest_win_streak = current_win_streak
                    longest_win_streak_amount = current_win_streak_amount
            elif daily_net < 0:  # Losing day
                current_loss_streak += 1
                current_loss_streak_amount += daily_net
                current_win_streak = 0
                current_win_streak_amount = 0
                if current_loss_streak > longest_loss_streak:
                    longest_loss_streak = current_loss_streak
                    longest_loss_streak_amount = current_loss_streak_amount
            else:  # Break-even day (net_pnl == 0) - resets both streaks
                current_win_streak = 0
                current_loss_streak = 0
                current_win_streak_amount = 0
                current_loss_streak_amount = 0
    
    current_streak = current_win_streak if current_win_streak > 0 else current_loss_streak
    current_streak_type = 'win' if current_win_streak > 0 else 'loss'
    
    # Update or create stats record
    stats = OverallStats.query.first()
    if not stats:
        stats = OverallStats()
        db.session.add(stats)
    
    stats.total_trades = total_trades
    stats.winning_trades = winning_trades
    stats.losing_trades = losing_trades
    stats.break_even_trades = break_even_trades
    stats.win_rate = win_rate
    stats.loss_rate = loss_rate
    stats.gross_profit = safe_float(gross_profit)
    stats.gross_loss = safe_float(gross_loss)
    stats.net_pnl = safe_float(net_pnl)
    stats.total_commission = safe_float(total_commission)
    stats.avg_win = safe_float(avg_win)
    stats.avg_loss = safe_float(avg_loss)
    stats.largest_profit = safe_float(largest_profit)
    stats.largest_loss = safe_float(largest_loss)
    stats.profit_factor = profit_factor
    stats.expectancy = expectancy
    stats.sharpe_ratio = safe_float(sharpe_ratio)
    stats.sortino_ratio = safe_float(sortino_ratio)
    stats.calmar_ratio = safe_float(calmar_ratio)
    stats.avg_trade_duration = int(avg_trade_duration) if avg_trade_duration else 0
    stats.longest_win_streak = longest_win_streak
    stats.longest_loss_streak = longest_loss_streak
    stats.current_streak = current_streak
    stats.current_streak_type = current_streak_type
    
    # MAE/MFE stats (placeholder - would need actual trade data)
    stats.mfe_capture = 0
    stats.mae_recovery = 0
    stats.efficiency_ratio = 0
    stats.avg_risk_reward = 0
    stats.exit_gap = 0
    stats.left_on_table = 0
    stats.good_captures = 0
    
    db.session.commit()
    
    return stats.to_dict()


def calculate_daily_stats(account_id=None, *, only_account=False):
    """Calculate daily statistics from trades, grouped by account.

    When only_account is True, replace daily stats for that account_id only.
    None means trades that are not assigned to an account. Otherwise every
    account's daily stats are replaced.
    """
    if only_account:
        DailyStats.query.filter(DailyStats.account_id == account_id).delete(synchronize_session='fetch')
    else:
        # Clear existing daily stats to avoid duplicates
        DailyStats.query.delete()

    # Process closed trades (group by exit_date)
    closed_query = Trade.query.filter(
        Trade.is_open == False,
        Trade.exit_date.isnot(None)
    )
    if only_account:
        closed_query = closed_query.filter(Trade.account_id == account_id)
    closed_trades = closed_query.all()

    if closed_trades:
        df = pd.DataFrame([t.to_dict() for t in closed_trades])
        df['exit_date'] = pd.to_datetime(df['exit_date'])
        df['net_pnl'] = df['net_pnl'].astype(float)
        df['gross_pnl'] = df['gross_pnl'].astype(float)
        df['total_commissions'] = df['total_commissions'].astype(float)
        
        # Fill None account_id with 0 for grouping (legacy data)
        df['account_id'] = df['account_id'].fillna(0).astype(int)
        
        # Group by exit date AND account_id
        daily = df.groupby([df['exit_date'].dt.date, 'account_id']).agg({
            'net_pnl': ['count', 'sum', 'mean'],
            'gross_pnl': 'sum',
            'total_commissions': 'sum'
        }).reset_index()
        
        daily.columns = ['date', 'account_id', 'total_trades', 'net_pnl', 'avg_trade_pnl', 'gross_pnl', 'total_commission']
        
        for idx, row in daily.iterrows():
            date = row['date']
            row_account_id = int(row['account_id'])
            # Convert 0 back to None for database (legacy data)
            db_account_id = None if row_account_id == 0 else row_account_id
            
            day_trades = df[(df['exit_date'].dt.date == date) & (df['account_id'] == row_account_id)]
            
            winning_trades = len(day_trades[day_trades['net_pnl'] > 0])
            losing_trades = len(day_trades[day_trades['net_pnl'] < 0])
            break_even_trades = len(day_trades[day_trades['net_pnl'] == 0])
            
            largest_profit = safe_float(day_trades['net_pnl'].max())
            largest_loss = safe_float(day_trades['net_pnl'].min())
            
            # Update or create daily stats - filter by both date and account_id
            daily_stat = DailyStats.query.filter_by(date=date, account_id=db_account_id).first()
            if not daily_stat:
                daily_stat = DailyStats(date=date, account_id=db_account_id)
                db.session.add(daily_stat)
            
            daily_stat.total_trades = int(row['total_trades'])
            daily_stat.winning_trades = winning_trades
            daily_stat.losing_trades = losing_trades
            daily_stat.break_even_trades = break_even_trades
            daily_stat.gross_pnl = float(row['gross_pnl'])
            daily_stat.net_pnl = float(row['net_pnl'])
            daily_stat.total_commission = float(row['total_commission'])
            daily_stat.largest_profit = largest_profit
            daily_stat.largest_loss = largest_loss
            daily_stat.avg_trade_pnl = float(row['avg_trade_pnl'])
    
    # Process open trades (group by entry_date) and merge into daily stats
    open_query = Trade.query.filter(
        Trade.is_open == True,
        Trade.entry_date.isnot(None)
    )
    if only_account:
        open_query = open_query.filter(Trade.account_id == account_id)
    open_trades = open_query.all()
    
    if open_trades:
        from collections import defaultdict
        open_by_date_account = defaultdict(int)
        for trade in open_trades:
            open_by_date_account[(trade.entry_date, trade.account_id)] += 1
        
        for (date, open_account_id), count in open_by_date_account.items():
            daily_stat = DailyStats.query.filter_by(date=date, account_id=open_account_id).first()
            if not daily_stat:
                daily_stat = DailyStats(date=date, account_id=open_account_id)
                db.session.add(daily_stat)
                daily_stat.net_pnl = 0
                daily_stat.gross_pnl = 0
                daily_stat.total_commission = 0
                daily_stat.largest_profit = 0
                daily_stat.largest_loss = 0
                daily_stat.avg_trade_pnl = 0
                daily_stat.winning_trades = 0
                daily_stat.losing_trades = 0
                daily_stat.break_even_trades = 0
                daily_stat.total_trades = count
            else:
                daily_stat.total_trades = (daily_stat.total_trades or 0) + count
    
    db.session.commit()

    result_query = DailyStats.query
    if only_account:
        result_query = result_query.filter(DailyStats.account_id == account_id)
    return [d.to_dict() for d in result_query.order_by(DailyStats.date.desc()).all()]


def calculate_hourly_stats():
    """Calculate statistics by hour of day from executions"""
    executions = Execution.query.filter(Execution.exec_datetime.isnot(None)).all()
    
    if not executions:
        return []
    
    df = pd.DataFrame([e.to_dict() for e in executions])
    df['net_cash'] = df['net_cash'].astype(float)
    df['exec_datetime'] = pd.to_datetime(df['exec_datetime'])
    df['hour'] = df['exec_datetime'].dt.hour
    
    # Group by hour
    hourly = df.groupby('hour').agg({
        'net_cash': ['count', 'sum', 'mean'],
    }).reset_index()
    
    hourly.columns = ['hour', 'total_trades', 'net_pnl', 'avg_pnl']
    
    # Clear existing stats
    HourlyStats.query.delete()
    
    for idx, row in hourly.iterrows():
        hour = int(row['hour'])
        hour_execs = df[df['hour'] == hour]
        winning_trades = len(hour_execs[hour_execs['net_cash'] > 0])
        
        # Handle NaN values - convert to 0
        avg_pnl_val = row['avg_pnl']
        if pd.isna(avg_pnl_val):
            avg_pnl_val = 0
        
        stat = HourlyStats(
            hour=hour,
            total_trades=int(row['total_trades']),
            winning_trades=winning_trades,
            net_pnl=float(row['net_pnl']),
            avg_pnl=float(avg_pnl_val)
        )
        db.session.add(stat)
    
    db.session.commit()
    
    return [h.to_dict() for h in HourlyStats.query.order_by(HourlyStats.hour).all()]


def recalculate_all_stats():
    """Recalculate all statistics"""
    calculate_daily_stats()
    calculate_hourly_stats()
    return calculate_overall_stats()


# ============== Account-specific stats calculation functions ==============

def calculate_daily_stats_for_account(account_id):
    """Calculate daily statistics for a specific account"""
    # Delete existing stats for this account only
    DailyStats.query.filter_by(account_id=account_id).delete()
    
    # Process closed trades for this account (with exit_date)
    closed_trades = Trade.query.filter(
        Trade.is_open == False,
        Trade.exit_date.isnot(None),
        (Trade.account_id == account_id) | (Trade.account_id == None)
    ).all()
    
    if closed_trades:
        df = pd.DataFrame([t.to_dict() for t in closed_trades])
        df['exit_date'] = pd.to_datetime(df['exit_date'])
        df['net_pnl'] = df['net_pnl'].astype(float)
        df['gross_pnl'] = df['gross_pnl'].astype(float)
        df['total_commissions'] = df['total_commissions'].astype(float)
        
        # Group by exit date
        daily = df.groupby(df['exit_date'].dt.date).agg({
            'net_pnl': ['count', 'sum', 'mean'],
            'gross_pnl': 'sum',
            'total_commissions': 'sum'
        }).reset_index()
        
        daily.columns = ['date', 'total_trades', 'net_pnl', 'avg_trade_pnl', 'gross_pnl', 'total_commission']
        
        # Calculate winning/losing trades per day
        for idx, row in daily.iterrows():
            date = row['date']
            day_trades = df[df['exit_date'].dt.date == date]
            
            winning_trades = len(day_trades[day_trades['net_pnl'] > 0])
            losing_trades = len(day_trades[day_trades['net_pnl'] < 0])
            break_even_trades = len(day_trades[day_trades['net_pnl'] == 0])
            
            largest_profit = safe_float(day_trades['net_pnl'].max()) if len(day_trades) > 0 else 0
            largest_loss = safe_float(day_trades['net_pnl'].min()) if len(day_trades) > 0 else 0
            
            # Handle NaN values
            avg_pnl_val = row['avg_trade_pnl']
            if pd.isna(avg_pnl_val):
                avg_pnl_val = 0
            
            stat = DailyStats(
                date=date,
                account_id=account_id,
                total_trades=int(row['total_trades']),
                winning_trades=winning_trades,
                losing_trades=losing_trades,
                break_even_trades=break_even_trades,
                gross_pnl=float(row['gross_pnl']),
                net_pnl=float(row['net_pnl']),
                total_commission=float(row['total_commission']),
                largest_profit=float(largest_profit),
                largest_loss=float(largest_loss),
                avg_trade_pnl=float(avg_pnl_val)
            )
            db.session.add(stat)
    
    # Process open trades for this account (group by entry_date)
    open_trades = Trade.query.filter(
        Trade.is_open == True,
        Trade.entry_date.isnot(None),
        (Trade.account_id == account_id) | (Trade.account_id == None)
    ).all()
    
    if open_trades:
        from collections import defaultdict
        open_by_date = defaultdict(int)
        for trade in open_trades:
            open_by_date[trade.entry_date] += 1
        
        for date, count in open_by_date.items():
            daily_stat = DailyStats.query.filter_by(date=date, account_id=account_id).first()
            if not daily_stat:
                daily_stat = DailyStats(
                    date=date,
                    account_id=account_id,
                    total_trades=count,
                    winning_trades=0,
                    losing_trades=0,
                    break_even_trades=0,
                    gross_pnl=0,
                    net_pnl=0,
                    total_commission=0,
                    largest_profit=0,
                    largest_loss=0,
                    avg_trade_pnl=0
                )
                db.session.add(daily_stat)
            else:
                daily_stat.total_trades = (daily_stat.total_trades or 0) + count
    
    db.session.commit()
    
    return [s.to_dict() for s in DailyStats.query.filter_by(account_id=account_id).order_by(DailyStats.date).all()]


def calculate_hourly_stats_for_account(account_id):
    """Calculate statistics by hour of day for a specific account's executions"""
    executions = Execution.query.filter(
        Execution.exec_datetime.isnot(None),
        (Execution.account_id == account_id) | (Execution.account_id == None)
    ).all()
    
    if not executions:
        return []
    
    df = pd.DataFrame([e.to_dict() for e in executions])
    df['net_cash'] = df['net_cash'].astype(float)
    df['exec_datetime'] = pd.to_datetime(df['exec_datetime'])
    df['hour'] = df['exec_datetime'].dt.hour
    
    # Group by hour
    hourly = df.groupby('hour').agg({
        'net_cash': ['count', 'sum', 'mean'],
    }).reset_index()
    
    hourly.columns = ['hour', 'total_trades', 'net_pnl', 'avg_pnl']
    
    # Clear existing hourly stats (note: hourly stats are global, not per-account)
    # For now, we'll recalculate all hourly stats
    HourlyStats.query.delete()
    
    for idx, row in hourly.iterrows():
        hour = int(row['hour'])
        hour_execs = df[df['hour'] == hour]
        winning_trades = len(hour_execs[hour_execs['net_cash'] > 0])
        
        avg_pnl_val = row['avg_pnl']
        if pd.isna(avg_pnl_val):
            avg_pnl_val = 0
        
        stat = HourlyStats(
            hour=hour,
            total_trades=int(row['total_trades']),
            winning_trades=winning_trades,
            net_pnl=float(row['net_pnl']),
            avg_pnl=float(avg_pnl_val)
        )
        db.session.add(stat)
    
    db.session.commit()
    
    return [h.to_dict() for h in HourlyStats.query.order_by(HourlyStats.hour).all()]


def calculate_overall_stats_for_account(account_id):
    """Calculate overall trading statistics for a specific account"""
    trades = Trade.query.filter(
        Trade.is_open == False,
        (Trade.account_id == account_id) | (Trade.account_id == None)
    ).all()
    
    if not trades:
        return None
    
    df = pd.DataFrame([t.to_dict() for t in trades])
    df['net_pnl'] = df['net_pnl'].astype(float)
    df['gross_pnl'] = df['gross_pnl'].astype(float)
    
    # Filter out trades with no exit_date for date-based calculations
    df_with_exit = df[df['exit_date'].notna()].copy()
    
    total_trades = len(df)
    winning_trades = len(df[df['net_pnl'] > 0])
    losing_trades = len(df[df['net_pnl'] < 0])
    break_even_trades = len(df[df['net_pnl'] == 0])
    
    win_rate = safe_float((winning_trades / total_trades * 100) if total_trades > 0 else 0)
    loss_rate = safe_float((losing_trades / total_trades * 100) if total_trades > 0 else 0)
    
    gross_profit = safe_float(df[df['gross_pnl'] > 0]['gross_pnl'].sum())
    gross_loss = safe_float(abs(df[df['gross_pnl'] < 0]['gross_pnl'].sum()))
    net_pnl = safe_float(df['net_pnl'].sum())
    total_commission = safe_float(df['total_commissions'].sum())
    
    avg_win = safe_float(df[df['net_pnl'] > 0]['net_pnl'].mean() if winning_trades > 0 else 0)
    avg_loss = safe_float(df[df['net_pnl'] < 0]['net_pnl'].mean() if losing_trades > 0 else 0)
    
    largest_profit = safe_float(df['net_pnl'].max())
    largest_loss = safe_float(df['net_pnl'].min())
    
    profit_factor = safe_float(gross_profit / gross_loss if gross_loss != 0 else 0)
    expectancy = safe_float(df['net_pnl'].mean())
    
    # Default values for date-based calculations
    sharpe_ratio = 0
    sortino_ratio = 0
    calmar_ratio = 0
    avg_trade_duration = 0
    longest_win_streak = 0
    longest_loss_streak = 0
    current_win_streak = 0
    current_loss_streak = 0
    
    if len(df_with_exit) > 0:
        df_with_exit['exit_date'] = pd.to_datetime(df_with_exit['exit_date'])
        df_with_exit['entry_date'] = pd.to_datetime(df_with_exit['entry_date'])
        daily_returns = df_with_exit.groupby(df_with_exit['exit_date'].dt.date)['net_pnl'].sum()
        
        sharpe_ratio = compute_sharpe_ratio(daily_returns, get_account_starting_value(account_id))
        
        downside_returns = daily_returns[daily_returns < 0]
        if len(downside_returns) > 0 and downside_returns.std() != 0:
            sortino_ratio = safe_float((daily_returns.mean() / downside_returns.std()) * np.sqrt(252))
        
        cumulative = daily_returns.cumsum()
        running_max = cumulative.expanding().max()
        drawdown = cumulative - running_max
        max_drawdown = abs(drawdown.min()) if len(drawdown) > 0 else 0
        
        annual_return = safe_float(daily_returns.mean() * 252)
        calmar_ratio = safe_float(annual_return / max_drawdown if max_drawdown != 0 else 0)
        
        df_with_exit['duration_days'] = (df_with_exit['exit_date'] - df_with_exit['entry_date']).dt.days
        avg_trade_duration = safe_float(df_with_exit['duration_days'].mean())
        
        # Streak analysis
        daily_pnl = daily_returns.sort_index()
        
        for daily_net in daily_pnl:
            if daily_net > 0:
                current_win_streak += 1
                current_loss_streak = 0
                if current_win_streak > longest_win_streak:
                    longest_win_streak = current_win_streak
            elif daily_net < 0:
                current_loss_streak += 1
                current_win_streak = 0
                if current_loss_streak > longest_loss_streak:
                    longest_loss_streak = current_loss_streak
            else:
                current_win_streak = 0
                current_loss_streak = 0
    
    current_streak = current_win_streak if current_win_streak > 0 else -current_loss_streak
    current_streak_type = 'win' if current_win_streak > 0 else 'loss'
    
    stats = OverallStats(
        total_trades=total_trades,
        winning_trades=winning_trades,
        losing_trades=losing_trades,
        break_even_trades=break_even_trades,
        win_rate=win_rate,
        loss_rate=loss_rate,
        gross_profit=gross_profit,
        gross_loss=gross_loss,
        net_pnl=net_pnl,
        total_commission=total_commission,
        avg_win=avg_win,
        avg_loss=avg_loss,
        largest_profit=largest_profit,
        largest_loss=largest_loss,
        profit_factor=profit_factor,
        expectancy=expectancy,
        sharpe_ratio=sharpe_ratio,
        sortino_ratio=sortino_ratio,
        calmar_ratio=calmar_ratio,
        avg_trade_duration=avg_trade_duration,
        longest_win_streak=longest_win_streak,
        longest_loss_streak=longest_loss_streak,
        current_streak=abs(current_streak),
        current_streak_type=current_streak_type
    )
    db.session.add(stats)
    db.session.commit()
    
    return stats.to_dict()
