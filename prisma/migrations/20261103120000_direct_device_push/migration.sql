-- Attendance machines can push (ZKTeco ADMS) straight to the website, without an office sync agent.
ALTER TABLE `AttendanceDevice` ADD COLUMN `directPush` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `attlogStamp` VARCHAR(40) NULL;

-- Commands for a direct device have no agent; the device gets a numeric command number.
ALTER TABLE `AgentCommand` MODIFY `agentId` VARCHAR(191) NULL,
  ADD COLUMN `deviceCmdNo` INTEGER NULL;
CREATE INDEX `AgentCommand_deviceSerial_status_idx` ON `AgentCommand`(`deviceSerial`, `status`);
