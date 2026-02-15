# ------------------------------------------------------------------------------
# SNS – Notification Topic
# ------------------------------------------------------------------------------

resource "aws_sns_topic" "notifications" {
  name = "${local.name_prefix}-notifications"
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.notifications.arn
  protocol  = "email"
  endpoint  = var.notification_email
}
