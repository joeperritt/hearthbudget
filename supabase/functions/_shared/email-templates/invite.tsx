/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { styles } from './_brand.ts'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to Keeper</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.header}>
          <Text style={styles.monogram}>K</Text>
          <Text style={styles.brandName}>KEEPER</Text>
        </Section>
        <Section style={styles.body}>
          <Heading style={styles.h1}>You've been invited</Heading>
          <Text style={styles.text}>
            You've been invited to join a Keeper household. Accept below to
            set up your account and start budgeting together.
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              Accept Invitation
            </Button>
          </Section>
          <div style={styles.divider} />
          <Text style={styles.fineprint}>
            This invitation expires in 24 hours. If you weren't expecting it,
            you can safely ignore this email.
          </Text>
        </Section>
        <Section style={styles.footer}>
          <Text style={styles.footerText}>Keeper · Budgeting together.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
