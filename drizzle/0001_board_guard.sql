-- 整包恢复的空板断言守卫。
--
-- 恢复批次的第一条写操作是插入 completed_imports 幂等标记：
-- 该触发器在目标已有任何岗位（含已结束记录）时中止整批，
-- 阻止「校验期间另一端刚好新建岗位后继续导入」的窗口；
-- 仅预查一次或把影响零行当作成功都无法覆盖并发提交。
CREATE TRIGGER `completed_imports_require_empty_board`
BEFORE INSERT ON `completed_imports`
WHEN (SELECT COUNT(*) FROM `jobs`) > 0
BEGIN
	SELECT RAISE(ABORT, 'board_not_empty');
END;
